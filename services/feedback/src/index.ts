/**
 * The feedback Worker: `POST https://feedback.bindersnap.com/` with a
 * {@link FeedbackReport}, and an issue opens in the private feedback
 * repository.
 *
 * It runs on Cloudflare, not on the EC2 host, so a report still goes through
 * when the host is down — the time one matters most. It is allowed to by
 * ADR 0006, on its terms: it keeps nothing, it is off the critical path, and
 * it never talks to Gitea or the API. See
 * `docs/adr/0006-cloudflare-workers-at-the-edge.md`.
 *
 * In order, cheapest first: the origin, a per-IP rate limit, the size, the
 * shape, Turnstile (one use per token, so only once the rest has passed), and
 * GitHub. Logs say what happened and never what was written.
 */

import { FEEDBACK_MAX_BYTES } from "../../../packages/utils/feedbackReport";
import { createIssue, GitHubError } from "./github";
import { feedbackIssue } from "./issue";
import { feedbackReportSchema } from "./schema";
import { verifyTurnstile } from "./turnstile";

/** Cloudflare's Rate Limiting binding; only the part used here. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Comma-separated origins the app is served from. */
  ALLOWED_ORIGINS: string;
  /** `owner/name` of the private repository issues are opened in. */
  FEEDBACK_REPOSITORY: string;
  GITHUB_APP_ID: string;
  /** Secret: `wrangler secret put GITHUB_APP_PRIVATE_KEY`. */
  GITHUB_APP_PRIVATE_KEY: string;
  /** Secret: `wrangler secret put TURNSTILE_SECRET_KEY`. */
  TURNSTILE_SECRET_KEY: string;
  FEEDBACK_LIMITER: RateLimit;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};

export async function handle(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigin(origin, env);
  const cors = corsHeaders(allowed);

  if (new URL(request.url).pathname !== "/") {
    return reply(404, { error: "Not found." }, cors);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  }
  if (request.method !== "POST") {
    return reply(405, { error: "Send feedback with POST." }, cors);
  }
  if (!allowed) {
    log("refused", { reason: "origin", origin });
    return reply(403, { error: "This origin may not send feedback." }, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP");
  const { success: underLimit } = await env.FEEDBACK_LIMITER.limit({
    key: ip ?? "unknown",
  });
  if (!underLimit) {
    log("refused", { reason: "rate-limit" });
    return reply(
      429,
      { error: "That's a lot of feedback at once. Try again in a minute." },
      cors,
    );
  }

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > FEEDBACK_MAX_BYTES) return tooLarge(cors);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > FEEDBACK_MAX_BYTES) {
    return tooLarge(cors);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "The report is not JSON." }, cors);
  }
  const parsed = feedbackReportSchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    log("refused", { reason: "shape", fields });
    return reply(400, { error: "The report is not complete.", fields }, cors);
  }
  const report = parsed.data;

  const verdict = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    report.turnstileToken,
    ip,
    fetcher,
  );
  if (!verdict.success) {
    log("refused", { reason: "turnstile", codes: verdict.errorCodes });
    return reply(
      403,
      { error: "We couldn't confirm you're not a robot. Try again." },
      cors,
    );
  }

  try {
    await createIssue(
      {
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
        repository: env.FEEDBACK_REPOSITORY,
      },
      feedbackIssue(report),
      fetcher,
    );
  } catch (error) {
    log("failed", {
      step: error instanceof GitHubError ? error.step : "sign",
      status: error instanceof GitHubError ? error.status : undefined,
      message: error instanceof GitHubError ? undefined : String(error),
    });
    return reply(
      502,
      { error: "We couldn't file that just now. Try again in a moment." },
      cors,
    );
  }

  log("filed", { kind: report.kind });
  return reply(201, { received: true }, cors);
}

function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  const origins = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  return origins.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

function reply(status: number, body: unknown, headers: Headers): Response {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: out });
}

function tooLarge(cors: Headers): Response {
  log("refused", { reason: "size" });
  return reply(413, { error: "The report is too large." }, cors);
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
