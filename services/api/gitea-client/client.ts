import createClient from "openapi-fetch";

import { giteaRequestGate } from "./request-gate";
import type { paths } from "./spec/gitea";
import {
  currentRequestScope,
  forgetRequestMemo,
  recordGiteaCall,
  recordSharedGiteaCall,
} from "./usage";

/**
 * How long one Gitea call may take once it holds a slot.
 *
 * There was no deadline at all: a hung socket held one of four slots for as
 * long as it stayed hung, and every other user's page queued behind it. A
 * merge is the slowest call made and finishes in seconds; thirty is generous
 * for it and is also the API server's own idle timeout, past which nobody is
 * waiting for the answer anyway.
 */
export const GITEA_CALL_TIMEOUT_MS = 30_000;

/**
 * Every Gitea call queues here. See `request-gate.ts` for why.
 *
 * Timed on both sides of the gate, so a request's log line can tell time spent
 * waiting for a slot from time spent waiting for Gitea (`usage.ts`).
 */
export const gatedFetch = (input: Request): Promise<Response> => {
  if (input.method !== "GET") return fetchThroughGate(input);

  // **One read, shared by everybody asking for it at that moment.** The
  // library and Home ask for the same binder's tags and changes at once, and
  // a page that mounts twice asks twice. The key is the address and whose
  // credentials asked — Gitea's answer depends on who is asking — and the
  // entry is gone the moment the read settles, so nothing is kept to go stale
  // (AGENTS.md: caching Gitea state is banned; this caches nothing).
  const key = `${input.headers.get("Authorization") ?? ""} ${input.url}`;
  const shared = inFlightReads.get(key);
  if (shared) {
    recordSharedGiteaCall();
    const { signal } = currentRequestScope();
    return shared.then(
      (response) => response.clone(),
      // The read it joined was cancelled by the request that started it — that
      // browser left, this one did not. Ask for itself.
      (err: unknown) => {
        if (signal?.aborted) throw err;
        return fetchThroughGate(input);
      },
    );
  }

  const leader = fetchThroughGate(input);
  inFlightReads.set(key, leader);
  const forget = () => {
    if (inFlightReads.get(key) === leader) inFlightReads.delete(key);
  };
  leader.then(forget, forget);
  // A clone for the caller too, so the original's body stays unread for
  // whoever joins before it is forgotten.
  return leader.then((response) => response.clone());
};

/** Reads in flight right now, by credentials and address. */
const inFlightReads = new Map<string, Promise<Response>>();

function fetchThroughGate(input: Request): Promise<Response> {
  const queuedAt = performance.now();
  // A write makes any read this request shared stale. Cleared before, so a
  // read racing the write cannot be served the old answer, and after, so a
  // read that started meanwhile is not kept either.
  const writes = input.method !== "GET" && input.method !== "HEAD";
  if (writes) forgetRequestMemo();
  // Waits in this request's own lane, so a page fanning out over eighty calls
  // shares the slots with a single read instead of queueing it; and stops
  // waiting if the request's work is no longer wanted.
  const { lane, signal } = currentRequestScope();
  return giteaRequestGate.run(
    async () => {
      const startedAt = performance.now();
      const timeout = AbortSignal.timeout(GITEA_CALL_TIMEOUT_MS);
      try {
        return await globalThis.fetch(input, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } finally {
        if (writes) forgetRequestMemo();
        recordGiteaCall({
          waitMs: startedAt - queuedAt,
          durationMs: performance.now() - startedAt,
        });
      }
    },
    { lane, signal },
  );
}

export type GiteaClient = ReturnType<typeof createGiteaClient>;

export function createGiteaClient(baseUrl: string, token: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  return createClient<paths>({
    baseUrl: `${baseUrl}/api/v1`,
    headers,
    fetch: gatedFetch,
  });
}

/**
 * The same client, authenticated as a Gitea user rather than by token.
 *
 * Dev and test stacks bring Gitea up with admin credentials and no service
 * token to mint one from, so the BFF's privileged reads have always fallen
 * back to basic auth there. This is that fallback, for the reads that go
 * through the typed client instead of raw fetch.
 */
export function createGiteaBasicAuthClient(
  baseUrl: string,
  username: string,
  password: string,
) {
  return createClient<paths>({
    baseUrl: `${baseUrl}/api/v1`,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    },
    fetch: gatedFetch,
  });
}

export class GiteaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GiteaApiError";
  }
}

/**
 * Extract a GiteaApiError from any openapi-fetch error response.
 * Replaces the five-way readErrorMessage() functions that were duplicated
 * across every module when using the previous client library.
 */
export function toGiteaApiError(
  status: number,
  errorBody: unknown,
): GiteaApiError {
  if (errorBody instanceof GiteaApiError) {
    return errorBody;
  }

  let message = "Gitea request failed.";

  if (typeof errorBody === "string" && errorBody.trim() !== "") {
    message = errorBody;
  } else if (typeof errorBody === "object" && errorBody !== null) {
    const body = errorBody as Record<string, unknown>;
    if (typeof body.message === "string" && body.message.trim() !== "") {
      message = body.message;
    } else if (typeof body.error === "string" && body.error.trim() !== "") {
      message = body.error;
    }
  }

  return new GiteaApiError(status, message);
}

/**
 * Unwrap an openapi-fetch response, throwing GiteaApiError on failure.
 * Use this to replace the try/catch + toGiteaApiError pattern in every module.
 *
 * Usage:
 *   const repo = await unwrap(client.GET("/repos/{owner}/{repo}", { params: { path: { owner, repo } } }));
 */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;

  if (error !== undefined || data === undefined) {
    throw toGiteaApiError(response.status, error);
  }

  return data;
}

/**
 * Gitea's page ceiling. Asking for more is not an error, it is silently this:
 * `limit=100` answers with 50, and a caller that stops at "fewer than I asked
 * for" stops after the first page every time.
 */
export const GITEA_PAGE_SIZE = 50;

/**
 * Every page of a Gitea list, in order.
 *
 * Gitea answers an unpaged list with 30 and caps any page at 50, so a list
 * read once is a list that silently stops — binders past the thirtieth, seats
 * past the fiftieth. This reads `limit: 50` pages until a short one arrives.
 *
 * `maxPages` is a stop no real binder reaches, which turns a Gitea that ignored
 * `page` from an infinite loop into a bounded read.
 */
export async function readAllPages<T>(
  readPage: (query: {
    page: number;
    limit: number;
  }) => Promise<T[] | null | undefined>,
  options: {
    maxPages?: number;
    /**
     * Pages to ask for at once after the first. The first page is always read
     * alone, so a list that fits on one — most of them — costs one call; a
     * long one then costs `pages / parallel` round trips instead of `pages`.
     * A wave may read up to `parallel - 1` empty pages past the end.
     */
    parallel?: number;
  } = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? 200;
  const parallel = Math.max(1, options.parallel ?? 1);

  const first = (await readPage({ page: 1, limit: GITEA_PAGE_SIZE })) ?? [];
  const all: T[] = [...first];
  if (first.length < GITEA_PAGE_SIZE) return all;

  for (let page = 2; page <= maxPages; page += parallel) {
    const wave = Array.from(
      { length: Math.min(parallel, maxPages - page + 1) },
      (_, offset) => page + offset,
    );
    const batches = await Promise.all(
      wave.map(
        async (number) =>
          (await readPage({ page: number, limit: GITEA_PAGE_SIZE })) ?? [],
      ),
    );
    for (const batch of batches) {
      all.push(...batch);
      if (batch.length < GITEA_PAGE_SIZE) return all;
    }
  }

  return all;
}
