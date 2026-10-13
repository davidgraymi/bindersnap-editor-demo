/**
 * The uptime check: request the API's `/healthz` from outside AWS, and email
 * once when it stops answering and once when it answers again.
 *
 * It runs on Cloudflare every minute (`worker.ts`), so it sees what a browser
 * sees: Cloudflare → tunnel → Caddy → API. A healthy instance with a broken
 * API, Caddy or tunnel is exactly what the CloudWatch alarms cannot see.
 *
 * ADR 0006 lets this one Worker keep one KV key: the last result, so it can
 * tell a new outage from one it already reported. Nothing else is stored.
 */

/** Consecutive failed checks, one a minute, before the down email. */
export const FAILURES_BEFORE_ALERT = 2;

/** How long one check waits for an answer. */
export const CHECK_TIMEOUT_MS = 10_000;

export const STATE_KEY = "api";

/** Workers KV; only the part used here. */
export interface StateStore {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  /** The URL that must answer 200, e.g. https://api.bindersnap.com/healthz */
  HEALTHZ_URL: string;
  /** Sender on the bindersnap.com zone, which has Email Routing on. */
  ALERT_FROM: string;
  /** Secret: `wrangler secret put ALERT_TO`. A verified Email Routing destination. */
  ALERT_TO: string;
  STATE: StateStore;
}

export type SendRaw = (from: string, to: string, raw: string) => Promise<void>;

export type CheckResult = { ok: true } | { ok: false; reason: string };

export interface UptimeState {
  status: "up" | "down";
  /** When the current status began. */
  since: string;
  /** Consecutive failed checks. Stops counting once the down email is sent. */
  failures: number;
  /** When the current run of failures began. */
  failingSince?: string;
  /** What the last failed check saw. */
  reason?: string;
}

export interface Transition {
  state: UptimeState;
  /** Whether `state` differs from what is stored, so it must be written. */
  changed: boolean;
  alert: "down" | "up" | null;
}

export async function check(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "bindersnap-uptime" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    if (response.status === 200) return { ok: true };
    return { ok: false, reason: `answered HTTP ${response.status}` };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, reason: `no answer within ${timeoutMs / 1000} s` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `request failed: ${message}` };
  }
}

/** The next state from the stored one and this check. Pure. */
export function transition(
  stored: UptimeState | null,
  result: CheckResult,
  now: Date,
): Transition {
  const at = now.toISOString();
  const prev: UptimeState = stored ?? { status: "up", since: at, failures: 0 };

  if (result.ok) {
    if (prev.status === "down") {
      return {
        state: { status: "up", since: at, failures: 0 },
        changed: true,
        alert: "up",
      };
    }
    if (prev.failures > 0) {
      return {
        state: { status: "up", since: prev.since, failures: 0 },
        changed: true,
        alert: null,
      };
    }
    return { state: prev, changed: false, alert: null };
  }

  // Already reported: write nothing until it recovers.
  if (prev.status === "down") {
    return { state: prev, changed: false, alert: null };
  }

  const failures = prev.failures + 1;
  const failingSince = prev.failingSince ?? at;
  if (failures >= FAILURES_BEFORE_ALERT) {
    return {
      state: {
        status: "down",
        since: failingSince,
        failures,
        failingSince,
        reason: result.reason,
      },
      changed: true,
      alert: "down",
    };
  }
  return {
    state: { ...prev, failures, failingSince, reason: result.reason },
    changed: true,
    alert: null,
  };
}

export function alertEmail(
  kind: "down" | "up",
  state: UptimeState,
  previous: UptimeState | null,
  env: Pick<Env, "HEALTHZ_URL" | "ALERT_FROM" | "ALERT_TO">,
  now: Date,
): string {
  const subject =
    kind === "down" ? "Bindersnap API is down" : "Bindersnap API is back up";
  const body =
    kind === "down"
      ? [
          `${env.HEALTHZ_URL} has failed ${state.failures} checks in a row, one a minute, since ${utc(state.since)}.`,
          "",
          `Last check: ${state.reason ?? "unknown"}.`,
          "",
          "Checked from Cloudflare, so the path is Cloudflare → tunnel → Caddy → API.",
          "A 502 or 530 from Cloudflare usually means the tunnel or the host; a",
          "timeout or 5xx from the API means the API container.",
          "",
          "You will get one more email when it answers 200 again.",
        ]
      : [
          `${env.HEALTHZ_URL} answers 200 again as of ${utc(now.toISOString())}.`,
          "",
          `It was down from ${utc(previous?.since ?? state.since)}, about ${minutesBetween(previous?.since, now)} min.`,
        ];

  // Email Routing's send_email takes a raw RFC 5322 message.
  const host = env.ALERT_FROM.split("@")[1] ?? "bindersnap.com";
  return [
    `From: Bindersnap uptime <${env.ALERT_FROM}>`,
    `To: ${env.ALERT_TO}`,
    `Subject: ${subject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${host}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...body,
    "",
  ].join("\r\n");
}

/** One scheduled run: check, decide, email, then remember. */
export async function run(
  env: Env,
  sendRaw: SendRaw,
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<Transition> {
  const stored = parseState(await env.STATE.get(STATE_KEY, "json"));
  const result = await check(env.HEALTHZ_URL, fetcher);
  const next = transition(stored, result, now);

  if (next.alert) {
    // Send before remembering: if the email fails, the state stays as it was
    // and the next run tries again.
    const raw = alertEmail(next.alert, next.state, stored, env, now);
    await sendRaw(env.ALERT_FROM, env.ALERT_TO, raw);
  }
  if (next.changed) {
    await env.STATE.put(STATE_KEY, JSON.stringify(next.state));
  }

  console.log(
    JSON.stringify({
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      status: next.state.status,
      failures: next.state.failures,
      alert: next.alert,
    }),
  );
  return next;
}

function parseState(value: unknown): UptimeState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<UptimeState>;
  if (
    (v.status !== "up" && v.status !== "down") ||
    typeof v.since !== "string" ||
    typeof v.failures !== "number"
  ) {
    return null;
  }
  return v as UptimeState;
}

function utc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function minutesBetween(fromIso: string | undefined, to: Date): number {
  if (!fromIso) return 0;
  return Math.max(0, Math.round((to.getTime() - Date.parse(fromIso)) / 60_000));
}
