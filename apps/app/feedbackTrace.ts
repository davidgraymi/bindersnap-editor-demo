/**
 * What the app knew when somebody pressed **Send feedback**.
 *
 * A report that says "publishing does nothing" is a guess until it says which
 * change, which call failed and what the server logged for it. This module
 * keeps short ring buffers from the moment the page loads — the last API calls
 * with the API's request IDs, console errors and uncaught exceptions, the
 * pages visited — and {@link captureFeedbackTrace} adds who and where when the
 * dialog opens. The dialog shows all of it before anything is sent.
 *
 * **Never a body, never document text.** API calls are recorded as method,
 * path, status and timing; the path loses its query string, and anything that
 * looks like a token — an invitation link, a reset link — is cut out of every
 * URL. See `docs/adr/0006-cloudflare-workers-at-the-edge.md`.
 */

import type { QueryClient } from "@tanstack/react-query";

import {
  FEEDBACK_LIMITS,
  type FeedbackApiCall,
  type FeedbackError,
  type FeedbackErrorSource,
  type FeedbackFacts,
  type FeedbackTrace,
} from "../../packages/utils/feedbackReport";
import { setApiCallObserver } from "../../packages/api-client/mutator";
import { publicEnv } from "./publicEnv";

const loadedAt = Date.now();

/** A list that keeps only its newest `limit` entries. */
class Ring<T> {
  private items: T[] = [];
  constructor(private readonly limit: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.limit) this.items.shift();
  }
  list(): T[] {
    return [...this.items];
  }
  clear(): void {
    this.items = [];
  }
}

const apiCalls = new Ring<FeedbackApiCall>(FEEDBACK_LIMITS.apiCalls);
const errors = new Ring<FeedbackError>(FEEDBACK_LIMITS.errors);
const navigation = new Ring<{ at: string; path: string }>(
  FEEDBACK_LIMITS.navigation,
);

let started = false;

/**
 * Start listening. Once per page; later calls do nothing, so hot reload and
 * StrictMode's double effects do not stack wrappers on `console`.
 */
export function startFeedbackTrace(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setApiCallObserver((call) =>
    apiCalls.push({
      at: now(),
      method: call.method,
      path: redactUrl(call.path, { keepQuery: false }),
      status: call.status,
      durationMs: Math.round(call.durationMs),
      requestId: call.requestId ?? undefined,
    }),
  );

  wrapConsole("error");
  wrapConsole("warn");
  window.addEventListener("error", (event) =>
    recordError("uncaught", [event.error ?? event.message]),
  );
  window.addEventListener("unhandledrejection", (event) =>
    recordError("rejection", [event.reason]),
  );

  recordNavigation();
  window.addEventListener("popstate", recordNavigation);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      recordNavigation();
    };
  }
}

export interface FeedbackContext {
  /** The app's parsed route, flattened into facts by {@link routeFacts}. */
  route: object;
  user: { username: string; fullName?: string } | null;
  organization: { name: string; displayName?: string } | null;
  queryClient: QueryClient;
  /** Anything else the page knows that a triager would ask. */
  state?: FeedbackFacts;
}

export function captureFeedbackTrace(context: FeedbackContext): FeedbackTrace {
  return {
    capturedAt: now(),
    url: redactUrl(window.location.href, { keepQuery: true }),
    route: routeFacts(context.route),
    user: context.user
      ? {
          username: context.user.username,
          ...(context.user.fullName ? { name: context.user.fullName } : {}),
        }
      : null,
    organization: context.organization,
    app: appBuild(),
    environment: {
      userAgent: navigator.userAgent.slice(0, 500),
      language: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
      sinceLoadMs: Date.now() - loadedAt,
    },
    apiCalls: apiCalls.list(),
    errors: errors.list(),
    navigation: navigation.list(),
    failingQueries: failingQueries(context.queryClient),
    state: context.state ?? {},
  };
}

/** Which build this is. Baked in by `static-site.yml`; "dev" anywhere else. */
export function appBuild(): FeedbackTrace["app"] {
  return {
    version: publicEnv(() => process.env.BUN_PUBLIC_APP_VERSION) || "dev",
    commit: (publicEnv(() => process.env.BUN_PUBLIC_APP_COMMIT) || "dev").slice(
      0,
      12,
    ),
  };
}

/**
 * A route as flat facts: strings, numbers and booleans only, nothing secret.
 * An invitation route carries its token; that never leaves.
 */
export function routeFacts(route: object): FeedbackFacts {
  const facts: FeedbackFacts = {};
  for (const [key, value] of Object.entries(route)) {
    if (SECRET_KEY.test(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts[key] =
        typeof value === "string" ? value.slice(0, 500) : (value as number);
    }
    if (Object.keys(facts).length >= FEEDBACK_LIMITS.facts) break;
  }
  return facts;
}

const SECRET_KEY = /token|secret|password|code|key|sig/i;
/** Path segments that are themselves credentials: `/-/invitations/{token}`. */
const SECRET_SEGMENT = /\/(invitations?)\/[^/?#]+/gi;

/**
 * A URL with its secrets cut out: query values whose names look like
 * credentials, and the token segment of an invitation link. Relative paths
 * stay relative.
 */
export function redactUrl(
  raw: string,
  { keepQuery }: { keepQuery: boolean },
): string {
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(raw);
  let url: URL;
  try {
    url = new URL(raw, "https://relative.invalid");
  } catch {
    return "(unparseable URL)";
  }
  url.hash = "";
  url.pathname = url.pathname.replace(SECRET_SEGMENT, "/$1/[redacted]");
  if (!keepQuery) {
    url.search = "";
  } else {
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
  }
  const text = url.toString().replace(/%5Bredacted%5D/gi, "[redacted]");
  const out = relative ? text.replace("https://relative.invalid", "") : text;
  return out.slice(0, FEEDBACK_LIMITS.url);
}

function failingQueries(
  queryClient: QueryClient,
): FeedbackTrace["failingQueries"] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.status === "error")
    .slice(-FEEDBACK_LIMITS.failingQueries)
    .map((query) => ({
      key: JSON.stringify(query.queryKey).slice(0, 500),
      error: describeValue(query.state.error).slice(0, FEEDBACK_LIMITS.message),
    }));
}

function wrapConsole(level: "error" | "warn"): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    recordError(`console.${level}`, args);
    original(...args);
  };
}

function recordError(source: FeedbackErrorSource, args: unknown[]): void {
  try {
    const error = args.find((arg): arg is Error => arg instanceof Error);
    errors.push({
      at: now(),
      source,
      message: args
        .map(describeValue)
        .join(" ")
        .slice(0, FEEDBACK_LIMITS.message),
      ...(error?.stack
        ? { stack: error.stack.slice(0, FEEDBACK_LIMITS.stack) }
        : {}),
    });
  } catch {
    // Recording an error must never become one.
  }
}

function recordNavigation(): void {
  navigation.push({
    at: now(),
    path: redactUrl(window.location.pathname, { keepQuery: false }),
  });
}

function describeValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function now(): string {
  return new Date().toISOString();
}

/** For tests: forget everything recorded so far. */
export function resetFeedbackTraceForTests(): void {
  apiCalls.clear();
  errors.clear();
  navigation.clear();
}
