/**
 * Sending a feedback report to the feedback Worker. Its Turnstile check is in
 * `turnstile.ts`. See `services/feedback` and ADR 0006.
 *
 * Not through the API: the Worker is on Cloudflare so a report still goes
 * through when the API is down. It wants no cookie, so none is sent.
 */

import type { FeedbackReport } from "../../packages/utils/feedbackReport";
import { publicEnv } from "./publicEnv";

/** Where reports go. */
function feedbackUrl(): string {
  return publicEnv(() => process.env.BUN_PUBLIC_FEEDBACK_URL);
}

/** The feedback dialog's own Turnstile widget (services/feedback). */
export function feedbackTurnstileSiteKey(): string {
  return publicEnv(() => process.env.BUN_PUBLIC_TURNSTILE_SITE_KEY);
}

/**
 * Whether this build can send feedback at all. Without both, the app offers
 * no button, rather than one that fails: a fork, a script, or production
 * before its Turnstile widget exists.
 */
export function feedbackEnabled(): boolean {
  return feedbackUrl() !== "" && feedbackTurnstileSiteKey() !== "";
}

export class FeedbackSendError extends Error {}

export async function sendFeedback(report: FeedbackReport): Promise<void> {
  let response: Response;
  try {
    response = await fetch(feedbackUrl(), {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch {
    throw new FeedbackSendError(
      "We couldn't reach our feedback service. Check your connection and try again.",
    );
  }
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  throw new FeedbackSendError(
    typeof payload?.error === "string"
      ? payload.error
      : "We couldn't send that just now. Try again in a moment.",
  );
}
