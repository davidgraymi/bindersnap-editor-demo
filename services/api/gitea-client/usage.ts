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

const storage = new AsyncLocalStorage<GiteaUsage>();

export function createGiteaUsage(): GiteaUsage {
  return { calls: 0, ungatedCalls: 0, gateWaitMs: 0, giteaMs: 0 };
}

/** Run `fn` with its own usage record, which every Gitea call inside adds to. */
export function withGiteaUsage<T>(usage: GiteaUsage, fn: () => T): T {
  return storage.run(usage, fn);
}

/** The usage of the request this code is running under, if any. */
export function currentGiteaUsage(): GiteaUsage | undefined {
  return storage.getStore();
}

export function recordGiteaCall(call: {
  gated: boolean;
  waitMs: number;
  durationMs: number;
}): void {
  const usage = storage.getStore();
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
