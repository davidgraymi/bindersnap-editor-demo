/**
 * How much of Gitea one API request used.
 *
 * A request's log line says how long it took. Without this it cannot say why:
 * "Gitea was slow" and "we asked Gitea eighty times" look the same from the
 * outside, and the second is the usual answer. Every Gitea call — through the
 * typed client or the raw `giteaFetch` — adds itself to the usage of the
 * request it ran under, and the response log line reports the totals.
 *
 * `AsyncLocalStorage` carries it, so no handler has to thread a counter
 * through a hundred call sites, and a call made outside any request (the
 * session reaper, startup) records nothing rather than landing on someone
 * else's line.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface GiteaUsage {
  /** Gitea calls this request made, gated or not. */
  calls: number;
  /** Of those, how many bypassed the request gate (raw `giteaFetch`). */
  ungatedCalls: number;
  /**
   * Time spent waiting for a gate slot, summed over calls. High means other
   * work held the slots, not that Gitea was slow.
   */
  gateWaitMs: number;
  /**
   * Time Gitea took to answer, summed over calls. Calls run in parallel, so
   * this can exceed the request's own duration; the ratio is the point.
   */
  giteaMs: number;
}

interface RequestScope {
  usage: GiteaUsage;
  /** Reads shared within this request. See {@link memoizeForRequest}. */
  memo: Map<string, Promise<unknown>>;
}

const storage = new AsyncLocalStorage<RequestScope>();

export function createGiteaUsage(): GiteaUsage {
  return { calls: 0, ungatedCalls: 0, gateWaitMs: 0, giteaMs: 0 };
}

/** Run `fn` with its own usage record, which every Gitea call inside adds to. */
export function withGiteaUsage<T>(usage: GiteaUsage, fn: () => T): T {
  return storage.run({ usage, memo: new Map() }, fn);
}

/** The usage of the request this code is running under, if any. */
export function currentGiteaUsage(): GiteaUsage | undefined {
  return storage.getStore()?.usage;
}

/**
 * One answer per request for a read several helpers make.
 *
 * Change detail asked for the same branch protection twice — once for the
 * approval count, once for the sign-off gate — because two helpers each read
 * it. This lets them share the read without threading it between them.
 *
 * **Not a cache.** Nothing outlives the request, so nothing can go stale
 * across requests, and AGENTS.md's ban on caching Gitea state does not bite.
 * Within a request, any write to Gitea clears it ({@link forgetRequestMemo},
 * called from the fetch wrappers), so a read after a write asks again.
 *
 * `key` must say everything the answer depends on, including whose
 * credentials asked. Outside a request it simply calls `read`.
 */
export function memoizeForRequest<T>(
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return read();

  const held = scope.memo.get(key);
  if (held) return held as Promise<T>;

  const pending = read();
  scope.memo.set(key, pending);
  // A failed read is not an answer to share: the next caller asks again.
  pending.catch(() => {
    if (scope.memo.get(key) === pending) scope.memo.delete(key);
  });
  return pending;
}

/** Drop this request's shared reads. Called on every Gitea write. */
export function forgetRequestMemo(): void {
  storage.getStore()?.memo.clear();
}

export function recordGiteaCall(call: {
  gated: boolean;
  waitMs: number;
  durationMs: number;
}): void {
  const usage = storage.getStore()?.usage;
  if (!usage) return;
  usage.calls += 1;
  if (!call.gated) usage.ungatedCalls += 1;
  usage.gateWaitMs += call.waitMs;
  usage.giteaMs += call.durationMs;
}

/** Rounded for a log line: fractions of a millisecond are noise there. */
export function giteaUsageLogFields(usage: GiteaUsage): Record<string, number> {
  return {
    giteaCalls: usage.calls,
    giteaUngatedCalls: usage.ungatedCalls,
    giteaGateWaitMs: Math.round(usage.gateWaitMs),
    giteaMs: Math.round(usage.giteaMs),
  };
}
