/**
 * What the app's **Send feedback** dialog sends, and what the feedback Worker
 * (`services/feedback`) accepts. The Worker checks it with a schema typed
 * against these interfaces, so the two cannot drift; this file stays free of
 * zod so the app does not ship a validator it never runs.
 *
 * The trace is what the app knew when the dialog opened: who, where, and what
 * just happened. It never carries a request or response body, document text or
 * a screenshot — all three can hold patient information, and the route already
 * says exactly which document and version the person was looking at. See
 * `docs/adr/0006-cloudflare-workers-at-the-edge.md`.
 */

/** The whole request, as the Worker reads it, may not be larger than this. */
export const FEEDBACK_MAX_BYTES = 64 * 1024;

export const FEEDBACK_LIMITS = {
  title: 120,
  description: 5000,
  apiCalls: 20,
  errors: 20,
  navigation: 15,
  failingQueries: 10,
  /** Keys in `route` or `state`. */
  facts: 30,
  message: 1000,
  stack: 4000,
  url: 2000,
} as const;

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Flat key → value facts, like a parsed route or the editor's state. */
export type FeedbackFacts = Record<string, string | number | boolean | null>;

export interface FeedbackApiCall {
  at: string;
  method: string;
  /** The path only. A query string can carry what someone searched for. */
  path: string;
  /** 0 when the call never got an answer (offline, CORS, aborted). */
  status: number;
  durationMs: number;
  /** The API's `X-Request-Id`: every log line it wrote for this call. */
  requestId?: string;
}

export type FeedbackErrorSource =
  "console.error" | "console.warn" | "uncaught" | "rejection";

export interface FeedbackError {
  at: string;
  source: FeedbackErrorSource;
  message: string;
  stack?: string;
}

export interface FeedbackTrace {
  capturedAt: string;
  url: string;
  /** The app's parsed `Route`: org, binder, document, ref, version, change. */
  route: FeedbackFacts;
  /** Who the app says is signed in. Nothing signs this; it is self-reported. */
  user: { username: string; name?: string; email?: string } | null;
  /** The organization on screen: its URL name, and what its owner called it. */
  organization: { name: string; displayName?: string } | null;
  app: { version: string; commit: string };
  environment: {
    userAgent: string;
    language: string;
    timeZone: string;
    viewport: string;
    devicePixelRatio: number;
    online: boolean;
    /**
     * How long the page had been open. A fresh load and a tab left open for a
     * week fail in different ways.
     */
    sinceLoadMs: number;
  };
  apiCalls: FeedbackApiCall[];
  errors: FeedbackError[];
  navigation: { at: string; path: string }[];
  failingQueries: { key: string; error: string }[];
  /** What the page itself reports: unsaved edits, an open draft. */
  state: FeedbackFacts;
}

export interface FeedbackReport {
  kind: FeedbackKind;
  title: string;
  description: string;
  trace: FeedbackTrace;
  /** Turnstile's token, checked by the Worker and then thrown away. */
  turnstileToken: string;
}
