/**
 * What the app and the API send when something throws, and what the feedback
 * Worker's `/errors` route (`services/feedback`) accepts. The Worker checks it
 * with a schema typed against this interface; this file stays free of zod so
 * the app does not ship a validator it never runs.
 *
 * **What broke, never for whom.** No user, no organization, no URL, no
 * request or response body. `where` names a kind of page or a job, and the
 * API's request ID finds the rest in CloudWatch. Every sender scrubs with
 * {@link scrubErrorText}, and the Worker scrubs again, because an error
 * message is not something a person chose to send. See
 * `docs/adr/0006-cloudflare-workers-at-the-edge.md`, "Error Reports".
 */

/** The whole request, as the Worker reads it, may not be larger than this. */
export const ERROR_REPORT_MAX_BYTES = 16 * 1024;

export const ERROR_REPORT_LIMITS = {
  kind: 120,
  message: 500,
  stack: 4000,
  where: 80,
  requestIds: 5,
  browser: 300,
} as const;

export const ERROR_SOURCES = ["app", "api"] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export interface ErrorReport {
  source: ErrorSource;
  /**
   * What kind of failure: the error's name in the app (`TypeError`), or the
   * line the API logged (`Unhandled route exception`).
   */
  kind: string;
  /** Scrubbed. */
  message: string;
  /** Scrubbed. */
  stack?: string;
  /**
   * Which kind of page (the app's route kind, `binderDocument`) or which part
   * of the API. Never an organization, binder or document name.
   */
  where: string;
  app: { version: string; commit: string };
  occurredAt: string;
  /** The API's `X-Request-Id`s that go with it: its log lines in CloudWatch. */
  requestIds: string[];
  /** The app only: the browser's user agent. */
  browser?: string;
  /** The app only: how long the page had been open. */
  sinceLoadMs?: number;
}

/** An email address, anywhere. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A URL up to whitespace or a closing quote or bracket. */
const URL_PATTERN = /\bhttps?:\/\/[^\s'"<>()[\]]+/g;
/** A script or stylesheet: its path is the build's, not anybody's. */
const ASSET_PATH = /\.(?:m?js|css|map)$/i;
/** Phone and social security shapes: 555-123-4567, 123-45-6789. */
const GROUPED_DIGITS = /\b\d{3}[-. ]\d{2,4}[-. ]\d{4}\b/g;
/**
 * Five or more digits in a row: a record number, an account, a date stamp.
 * Not after a colon, which is a stack frame's line or column.
 */
const LONG_NUMBER = /(?<![:\d])\d{5,}/g;
/**
 * A long run of letters and digits with at least one digit in it: a token, a
 * key, a hash, an ID.
 */
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}\b/g;
/**
 * A quoted phrase with a space in it. A property name is one word, and keeps
 * its quotes (`reading 'title'`); a phrase is somebody's words: a title, a
 * name, a sentence from a document.
 */
const QUOTED_PHRASE = [
  /"[^"\n]*\s[^"\n]*"/g,
  /'[^'\n]*\s[^'\n]*'/g,
  /“[^”\n]*”/g,
  /`[^`\n]*\s[^`\n]*`/g,
];

/**
 * An error's message or stack with what could identify a person cut out:
 * emails, URLs' paths and queries (a script's path stays, a stack needs it),
 * phone- and SSN-shaped numbers, long numbers, tokens, and quoted phrases.
 * Then cut to `max`.
 */
export function scrubErrorText(text: string, max: number): string {
  let out = text.replace(EMAIL, "[email]").replace(URL_PATTERN, scrubUrl);
  for (const phrase of QUOTED_PHRASE) {
    out = out.replace(phrase, (match) => `${match[0]}…${match.at(-1)}`);
  }
  out = out
    .replace(GROUPED_DIGITS, "[number]")
    .replace(TOKEN, "[token]")
    .replace(LONG_NUMBER, "[number]");
  return out.slice(0, max);
}

function scrubUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "[url]";
  }
  // `:line:column` after a script in a stack frame parses as part of its path.
  const position = /(?::\d+){1,2}$/.exec(url.pathname)?.[0] ?? "";
  const path = url.pathname.slice(0, url.pathname.length - position.length);
  if (ASSET_PATH.test(path)) return `${url.origin}${path}${position}`;
  return `${url.origin}/[path]`;
}

/**
 * The part of a report that says which error it is, with everything that
 * differs between two occurrences of the same one taken out: every number,
 * every hex ID, every placeholder the scrub left.
 */
export function fingerprintText(
  report: Pick<ErrorReport, "source" | "kind" | "message">,
): string {
  const message = scrubErrorText(report.message, ERROR_REPORT_LIMITS.message)
    .replace(/\b[0-9a-f]{8,}\b/gi, "x")
    .replace(/\d+/g, "0")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${report.source}\n${report.kind.trim()}\n${message}`;
}

/**
 * Twelve hex characters naming an error, the same for every occurrence of it.
 * It goes in its issue's title, where GitHub's search finds it again.
 */
export async function errorFingerprint(
  report: Pick<ErrorReport, "source" | "kind" | "message">,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprintText(report)),
  );
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
