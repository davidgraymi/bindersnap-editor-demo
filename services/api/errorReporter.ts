/**
 * Every `logger.error` line, sent on to the feedback Worker's `/errors` route,
 * where it becomes a GitHub issue in the private errors repository (ADR 0006,
 * "Error Reports"). The log line is still written first, and is still the
 * whole record: the report carries the request ID that finds it.
 *
 * **What broke, never for whom.** The report is the log line's message (a
 * sentence in our code, like "A job runner pass failed"), the error's scrubbed
 * text and stack, and the request ID. The line's other fields — owner,
 * repository, username, branch, path — never leave, and where the error's text
 * repeats one of them, it reads `[owner]` instead.
 *
 * Off the critical path: fire and forget, five seconds at most, four in flight
 * at most, each error once a minute, and a failure is a warning, never an
 * error, so it cannot report itself.
 */

import {
  ERROR_REPORT_LIMITS,
  fingerprintText,
  scrubErrorText,
  type ErrorReport,
} from "../../packages/utils/errorReport";
import { logger, setErrorListener, type LogMeta } from "./logger";

export interface ErrorReporterOptions {
  url: string;
  secret: string;
  /** Which build: the deployed commit. */
  release: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

/** The same error is sent once in this long. */
export const REPEAT_WINDOW_MS = 60_000;
const MAX_IN_FLIGHT = 4;
const MAX_REMEMBERED = 500;
const TIMEOUT_MS = 5_000;

/** Fields that say what failed; every other field is about whom. */
const ERROR_FIELDS = new Set(["error", "message", "stack", "errorType"]);

/**
 * Start sending. Without both a URL and a secret it sends nothing: the local
 * stack, CI, and production until `error_report_secret` is in SSM.
 * Returns what stops it.
 */
export function startErrorReporter(options: ErrorReporterOptions): () => void {
  if (options.url === "" || options.secret === "") return () => {};
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const lastSent = new Map<string, number>();
  let inFlight = 0;

  setErrorListener((message, meta) => {
    const report = buildApiErrorReport(message, meta, options.release);
    const key = fingerprintText(report);
    const at = now();
    if (at - (lastSent.get(key) ?? -Infinity) < REPEAT_WINDOW_MS) return;
    if (inFlight >= MAX_IN_FLIGHT) return;
    if (lastSent.size >= MAX_REMEMBERED) lastSent.clear();
    lastSent.set(key, at);

    inFlight++;
    fetcher(options.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) {
          logger.warn("Error report not sent", { status: response.status });
        }
      })
      .catch((err: unknown) => {
        logger.warn("Error report not sent", {
          reason: err instanceof Error ? err.name : "unknown",
        });
      })
      .finally(() => {
        inFlight--;
      });
  });
  return () => setErrorListener(null);
}

export function buildApiErrorReport(
  message: string,
  meta: LogMeta,
  release: string,
): ErrorReport {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const error = meta.err instanceof Error ? meta.err : null;
  const detail = text(meta.error) || text(meta.message) || error?.message || "";
  const stack = text(meta.stack) || error?.stack || "";
  const requestId = text(meta.requestId);

  return {
    source: "api",
    kind: scrubErrorText(message, ERROR_REPORT_LIMITS.kind),
    message: scrubErrorText(
      withoutNames(detail, meta),
      ERROR_REPORT_LIMITS.message,
    ),
    ...(stack
      ? {
          stack: scrubErrorText(
            withoutNames(stack, meta),
            ERROR_REPORT_LIMITS.stack,
          ),
        }
      : {}),
    // A request, or the job runner, outbox and reaper that run beside them.
    where: requestId ? "request" : "background",
    app: { version: "api", commit: release.slice(0, 12) },
    occurredAt: new Date().toISOString(),
    requestIds: requestId ? [requestId] : [],
  };
}

/**
 * `text` with every value of the line's other fields replaced by the field's
 * name: "repository riverside/clinical not found" with `repo: "clinical"`
 * reads "repository riverside/[repo] not found". Longest first, so a value
 * that holds another is replaced whole.
 */
function withoutNames(text: string, meta: LogMeta): string {
  const names = Object.entries(meta)
    .filter(
      (entry): entry is [string, string | number] =>
        !ERROR_FIELDS.has(entry[0]) &&
        entry[0] !== "requestId" &&
        (typeof entry[1] === "string" || typeof entry[1] === "number") &&
        String(entry[1]).length >= 3,
    )
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [key, value] of names) out = out.split(value).join(`[${key}]`);
  return out;
}
