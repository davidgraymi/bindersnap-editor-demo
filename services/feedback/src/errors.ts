/**
 * `POST https://feedback.bindersnap.com/errors`: something threw in the app or
 * the API, and an issue opens, or gets a comment, in the private errors
 * repository. ADR 0006, "Error Reports", is why it is here and what it may
 * carry.
 *
 * Two senders. The app proves nothing but its `Origin`; an error cannot stop
 * to solve a Turnstile challenge. The API sends `Authorization: Bearer
 * ERROR_REPORT_SECRET`. Either way the report is scrubbed again here, so a
 * sender that forgot cannot file what it should not.
 *
 * In order, cheapest first: who sent it, a per-IP limit (the app's), the size,
 * the shape, the fingerprint, a per-fingerprint limit so a burst writes once,
 * an overall limit that keeps GitHub's search quota safe, and GitHub. A report
 * a limit drops still answers 202: the sender has nothing to do about it.
 */

import {
  ERROR_REPORT_LIMITS,
  ERROR_REPORT_MAX_BYTES,
  errorFingerprint,
  scrubErrorText,
  type ErrorReport,
} from "../../../packages/utils/errorReport";
import { errorIssue, errorLabels, occurrenceComment } from "./errorIssue";
import { errorReportSchema } from "./errorSchema";
import { connect, GitHubError } from "./github";
import { allowedOrigin, log, readCapped, reply } from "./http";
import type { Env } from "./index";

export async function handleErrorReport(
  request: Request,
  env: Env,
  cors: Headers,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const sender = await identify(request, env);
  if (!sender) {
    log("refused", { route: "errors", reason: "sender" });
    return reply(403, { error: "This sender may not report errors." }, cors);
  }

  if (sender === "app") {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.ERROR_IP_LIMITER.limit({ key: ip });
    if (!success) {
      log("refused", { route: "errors", reason: "rate-limit" });
      return reply(429, { error: "Too many error reports." }, cors);
    }
  }

  const raw = await readCapped(request, ERROR_REPORT_MAX_BYTES);
  if (raw === null) {
    log("refused", { route: "errors", reason: "size" });
    return reply(413, { error: "The report is too large." }, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { error: "The report is not JSON." }, cors);
  }
  const parsed = errorReportSchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    log("refused", { route: "errors", reason: "shape", fields });
    return reply(400, { error: "The report is not complete.", fields }, cors);
  }
  if (parsed.data.source !== sender) {
    log("refused", { route: "errors", reason: "source" });
    return reply(403, { error: "This sender may not report errors." }, cors);
  }

  const report = scrub(parsed.data);
  const fingerprint = await errorFingerprint(report);
  const fields = { route: "errors", source: report.source, fingerprint };

  const once = await env.ERROR_FINGERPRINT_LIMITER.limit({
    key: `fp:${fingerprint}`,
  });
  if (!once.success) {
    log("dropped", { ...fields, reason: "fingerprint" });
    return accepted(cors);
  }
  const overall = await env.ERROR_OVERALL_LIMITER.limit({ key: "all" });
  if (!overall.success) {
    log("dropped", { ...fields, reason: "overall" });
    return accepted(cors);
  }

  try {
    const outcome = await file(report, fingerprint, env, fetcher);
    log(outcome, fields);
  } catch (error) {
    log("failed", {
      ...fields,
      step: error instanceof GitHubError ? error.step : "sign",
      status: error instanceof GitHubError ? error.status : undefined,
      message: error instanceof GitHubError ? undefined : String(error),
    });
    return reply(502, { error: "We couldn't file that just now." }, cors);
  }
  return accepted(cors);
}

/**
 * Open the fingerprint's issue, or add to it. GitHub's search finds it by the
 * fingerprint at the end of its title; the per-fingerprint limit is what keeps
 * the index's lag from opening it twice.
 */
async function file(
  report: ErrorReport,
  fingerprint: string,
  env: Env,
  fetcher: typeof fetch,
): Promise<"filed" | "commented" | "reopened" | "muted"> {
  const issues = await connect(
    {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      repository: env.ERRORS_REPOSITORY,
    },
    fetcher,
  );
  const found = (await issues.searchTitles(fingerprint)).find((issue) =>
    issue.title.endsWith(` · ${fingerprint}`),
  );

  if (!found) {
    await issues.create(errorIssue(report, fingerprint));
    return "filed";
  }
  if (found.state === "open") {
    await issues.comment(found.number, occurrenceComment(report));
    return "commented";
  }
  if (found.state_reason === "not_planned") return "muted";

  const labels = new Set([
    ...found.labels.map((label) => label.name),
    ...errorLabels(report),
    "regression",
  ]);
  await issues.reopen(found.number, [...labels]);
  await issues.comment(
    found.number,
    `Reopened: this happened again after it was closed.\n\n${occurrenceComment(report)}`,
  );
  return "reopened";
}

/** The app by its origin, the API by its secret, or nobody. */
async function identify(
  request: Request,
  env: Env,
): Promise<ErrorReport["source"] | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization !== null) {
    const secret = env.ERROR_REPORT_SECRET ?? "";
    if (secret === "") return null;
    return (await sameSecret(authorization, `Bearer ${secret}`)) ? "api" : null;
  }
  const origin = request.headers.get("Origin");
  return allowedOrigin(origin, env.ALLOWED_ORIGINS) ? "app" : null;
}

/** Equal, in time that says nothing about where two values differ. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

/** Scrubbed again, whatever the sender did. */
function scrub(report: ErrorReport): ErrorReport {
  return {
    ...report,
    kind: scrubErrorText(report.kind, ERROR_REPORT_LIMITS.kind),
    message: scrubErrorText(report.message, ERROR_REPORT_LIMITS.message),
    ...(report.stack !== undefined
      ? { stack: scrubErrorText(report.stack, ERROR_REPORT_LIMITS.stack) }
      : {}),
    where: scrubErrorText(report.where, ERROR_REPORT_LIMITS.where),
    requestIds: report.requestIds.map((id) => id.replace(/[^\w-]/g, "")),
  };
}

function accepted(cors: Headers): Response {
  return reply(202, { received: true }, cors);
}
