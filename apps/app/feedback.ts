/**
 * Sending a feedback report to the feedback Worker, and the Turnstile check
 * that goes with it. See `services/feedback` and ADR 0006.
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

function turnstileSiteKey(): string {
  return publicEnv(() => process.env.BUN_PUBLIC_TURNSTILE_SITE_KEY);
}

/**
 * Whether this build can send feedback at all. Without both, the app offers
 * no button, rather than one that fails: a fork, a script, or production
 * before its Turnstile widget exists.
 */
export function feedbackEnabled(): boolean {
  return feedbackUrl() !== "" && turnstileSiteKey() !== "";
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

/** The part of Turnstile's browser API used here. */
interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "always" | "execute" | "interaction-only";
      theme: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading: Promise<Turnstile> | null = null;

/** Turnstile's script, loaded the first time the dialog opens and kept. */
function loadTurnstile(): Promise<Turnstile> {
  const ready = (window as { turnstile?: Turnstile }).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      const turnstile = (window as { turnstile?: Turnstile }).turnstile;
      if (turnstile) resolve(turnstile);
      else reject(new Error("Turnstile did not load."));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile did not load."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Ask for a new token: each one works once. */
  reset(): void;
  remove(): void;
}

/**
 * Put a Turnstile check in `container`. Most people never see it — it shows
 * itself only when it needs somebody to click — and `onToken` hears each token
 * it issues, or `null` when the last one expired or the check failed.
 */
export async function mountTurnstile(
  container: HTMLElement,
  onToken: (token: string | null) => void,
): Promise<TurnstileHandle> {
  const turnstile = await loadTurnstile();
  const id = turnstile.render(container, {
    sitekey: turnstileSiteKey(),
    appearance: "interaction-only",
    theme: "auto",
    callback: (token) => onToken(token),
    "expired-callback": () => onToken(null),
    "error-callback": () => onToken(null),
  });
  return {
    reset: () => {
      onToken(null);
      turnstile.reset(id);
    },
    remove: () => turnstile.remove(id),
  };
}
