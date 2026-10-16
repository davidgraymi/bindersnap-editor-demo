/**
 * Something threw that nothing caught, and the feedback Worker's `/errors`
 * route hears about it (`services/feedback`, ADR 0006 "Error Reports").
 *
 * Uncaught errors and unhandled rejections only. React 19 hands a render
 * error nothing caught to `window.reportError`, which fires the same `error`
 * event, so a crashed screen is one of them. `console.error` is not: React's
 * warnings and the app's own handled failures go there, and they belong in a
 * feedback report's trace, not in an issue each.
 *
 * **What broke, never for whom.** The report is the error's type, its
 * scrubbed message and stack, which kind of page (`binderDocument`, never its
 * names), the build, the browser, and the request IDs of API calls that had
 * just failed. See `packages/utils/errorReport.ts`.
 *
 * It must never become a problem itself: it sends ten a page at most, each
 * error once, never throws, and sends nothing when the build has no address.
 */

import {
  ERROR_REPORT_LIMITS,
  scrubErrorText,
  type ErrorReport,
} from "../../packages/utils/errorReport";
import { appBuild, recentFailedRequestIds } from "./feedbackTrace";
import { publicEnv } from "./publicEnv";

/** No more than this many from one page load. */
export const ERRORS_PER_PAGE = 10;

const loadedAt = Date.now();
const seen = new Set<string>();
let started = false;

/** Where reports go. Empty in a build that sends none. */
function errorReportUrl(): string {
  return publicEnv(() => process.env.BUN_PUBLIC_ERROR_REPORT_URL);
}

/** Start listening. Once per page; later calls do nothing. */
export function startErrorReporter(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("error", (event) =>
    reportError(event.error ?? event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    reportError(event.reason),
  );
}

/** Send one, unless it is noise, a repeat, or one too many. */
export function reportError(
  error: unknown,
  send: typeof fetch = fetch,
): Promise<void> {
  try {
    const url = errorReportUrl();
    if (url === "" || ignored(error)) return Promise.resolve();
    const { kind, message, stack } = describe(error);
    const key = `${kind}\n${message}`;
    if (seen.has(key) || seen.size >= ERRORS_PER_PAGE) {
      return Promise.resolve();
    }
    seen.add(key);
    return pageKind()
      .then((where) =>
        send(url, {
          method: "POST",
          // Plain text is a simple request: no preflight, which a `keepalive`
          // request sent as the page unloads would not wait for.
          headers: { "Content-Type": "text/plain" },
          credentials: "omit",
          keepalive: true,
          body: JSON.stringify(
            buildErrorReport({ kind, message, stack, where }),
          ),
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    return Promise.resolve();
  }
}

export function buildErrorReport(error: {
  kind: string;
  message: string;
  stack?: string;
  where: string;
}): ErrorReport {
  return {
    source: "app",
    kind: scrubErrorText(error.kind, ERROR_REPORT_LIMITS.kind) || "Error",
    message: scrubErrorText(error.message, ERROR_REPORT_LIMITS.message),
    ...(error.stack
      ? { stack: scrubErrorText(error.stack, ERROR_REPORT_LIMITS.stack) }
      : {}),
    where: error.where.slice(0, ERROR_REPORT_LIMITS.where),
    app: appBuild(),
    occurredAt: new Date().toISOString(),
    requestIds: recentFailedRequestIds(ERROR_REPORT_LIMITS.requestIds),
    browser: navigator.userAgent.slice(0, ERROR_REPORT_LIMITS.browser),
    sinceLoadMs: Date.now() - loadedAt,
  };
}

/**
 * Not the app's to report:
 * - a failed API call: the API reports its own 5xx, and a 4xx is an answer;
 * - the network: offline, blocked, aborted;
 * - a browser extension's script, or another origin's (`Script error.`);
 * - the browser's own `ResizeObserver` loop notice.
 */
export function ignored(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  if (name === "ApiRequestError" || name === "AbortError") return true;
  if (
    name === "TypeError" &&
    /^(Failed to fetch|NetworkError|Load failed)/.test(message)
  ) {
    return true;
  }
  if (/^Script error\.?$/.test(message)) return true;
  if (/ResizeObserver loop/.test(message)) return true;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)) return true;
  return false;
}

function describe(error: unknown): {
  kind: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      kind: error.name || "Error",
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === "string") return { kind: "Error", message: error };
  let message: string;
  try {
    message = JSON.stringify(error) ?? String(error);
  } catch {
    message = String(error);
  }
  return { kind: "Unhandled rejection", message };
}

/**
 * The route's kind, and nothing else from it. Loaded when an error happens,
 * not at startup, so the first screen does not wait for the router; when the
 * error is that the app's code would not load, there is no kind to give.
 */
async function pageKind(): Promise<string> {
  try {
    const { getRoute } = await import("./routes");
    return getRoute(window.location.pathname).kind;
  } catch {
    return "unknown";
  }
}

/** For tests: forget what was sent. */
export function resetErrorReporterForTests(): void {
  seen.clear();
}
