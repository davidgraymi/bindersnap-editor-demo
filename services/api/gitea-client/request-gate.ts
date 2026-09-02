/**
 * A queue in front of Gitea, because Gitea is happier asked slowly.
 *
 * Gitea stores everything in SQLite, and every authenticated API call writes
 * to it before the handler even runs: `OAuth2.Verify` stamps `updated_unix`
 * on the access token being used. SQLite serializes its writers, so requests
 * made at the same time do not overlap — they queue on a write lock, each one
 * holding its connection while it waits.
 *
 * Past a handful in flight that queue becomes a convoy, and throughput falls
 * as concurrency rises. Measured against a seeded dev stack, the same 60
 * requests took 1.8s with 2 in flight and 7.1s with 30 — four times slower
 * for having asked harder. A page that fans out over a workspace hits this
 * immediately: 35 documents is over a hundred Gitea calls, and issuing them
 * all at once is the slowest way to make them.
 *
 * So the BFF holds its own queue and admits a few at a time. The gate wraps
 * the fetch itself rather than any one fan-out, which makes it both universal
 * — every caller is covered, including ones written later — and safe: a leaf
 * HTTP call never awaits another Gitea call, so nothing can ever block behind
 * a slot it is itself holding.
 */

/**
 * How many Gitea requests may be in flight at once.
 *
 * Measured throughput peaks around 2-4 and degrades from there. Four keeps
 * that peak while leaving enough parallelism to cover the round trips that
 * are not contending on the write lock.
 */
export const MAX_CONCURRENT_GITEA_REQUESTS = 4;

export interface RequestGate {
  /** Run `task` once a slot is free, releasing the slot when it settles. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** How many tasks hold a slot right now. Diagnostics and tests. */
  readonly inFlight: number;
  /** How many tasks are waiting for one. Diagnostics and tests. */
  readonly queued: number;
}

export function createRequestGate(limit: number): RequestGate {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Request gate limit must be a positive integer.");
  }

  let inFlight = 0;
  const waiting: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (inFlight < limit) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }

  function release(): void {
    // Hand the slot straight to the next waiter rather than freeing and
    // reclaiming it, so `inFlight` never dips below the work actually running.
    const next = waiting.shift();
    if (next) {
      next();
      return;
    }
    inFlight -= 1;
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    get inFlight() {
      return inFlight;
    },
    get queued() {
      return waiting.length;
    },
  };
}

/**
 * The process-wide gate. One Gitea, one queue — a per-client gate would let
 * each signed-in session open its own stampede.
 */
export const giteaRequestGate = createRequestGate(
  MAX_CONCURRENT_GITEA_REQUESTS,
);
