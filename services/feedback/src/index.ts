/**
 * The feedback Worker: `POST https://feedback.bindersnap.com/` with a
 * {@link FeedbackReport}, and an issue opens in the private feedback
 * repository. `POST /errors` is error reports, in `errors.ts`.
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
import { handleErrorReport } from "./errors";
import { createIssue, GitHubError } from "./github";
import { allowedOrigin, corsHeaders, log, readCapped, reply } from "./http";
import { feedbackIssue } from "./issue";
import { feedbackReportSchema } from "./schema";
import { verifyTurnstile } from "../../../packages/utils/turnstile";

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
  /** `owner/name` of the private repository error reports go to. */
  ERRORS_REPOSITORY: string;
  /**
   * Secret: `wrangler secret put ERROR_REPORT_SECRET`, the API's bearer for
   * `/errors`. Unset, the API's reports are refused and the app's still work.
   */
  ERROR_REPORT_SECRET?: string;
  /** The app's error reports, per IP. */
  ERROR_IP_LIMITER: RateLimit;
  /** One write a minute per fingerprint: a burst becomes one comment. */
  ERROR_FINGERPRINT_LIMITER: RateLimit;
  /** Every error write, together: GitHub's search allows 30 a minute. */
  ERROR_OVERALL_LIMITER: RateLimit;
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
  const allowed = allowedOrigin(origin, env.ALLOWED_ORIGINS);
  const cors = corsHeaders(allowed);

  const path = new URL(request.url).pathname;
  if (path !== "/" && path !== "/errors") {
    return reply(404, { error: "Not found." }, cors);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: allowed ? 204 : 403, headers: cors });
  }
  if (request.method !== "POST") {
    return reply(405, { error: "Send it with POST." }, cors);
  }
  if (path === "/errors") return handleErrorReport(request, env, cors, fetcher);

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

  const raw = await readCapped(request, FEEDBACK_MAX_BYTES);
  if (raw === null) return tooLarge(cors);

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

function tooLarge(cors: Headers): Response {
  log("refused", { reason: "size" });
  return reply(413, { error: "The report is too large." }, cors);
}
