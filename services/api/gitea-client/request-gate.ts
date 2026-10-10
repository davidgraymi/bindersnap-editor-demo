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
 *
 * That measurement was taken with Gitea's SQLite in its default rollback
 * journal. Both compose files now run it in WAL, where the collapse past four
 * mostly disappears (32 in flight measured 3.3x faster than in rollback
 * mode). Four is therefore conservative — but production is a two-vCPU host
 * shared with the API, Caddy and Litestream, so raise it only after measuring
 * there. The request log's `giteaGateWaitMs` says whether it is worth doing.
 */
export const MAX_CONCURRENT_GITEA_REQUESTS = 4;

/** How a task waits for its slot. */
export interface GateOptions {
  /**
   * Which queue it waits in. Waiters are admitted round-robin across lanes and
   * in order within one, so a page that fans out over eighty calls takes its
   * turn beside a single read rather than in front of it. One lane per API
   * request is what the client passes; omitted, a task shares the default
   * lane.
   */
  lane?: string;
  /**
   * Stops waiting when this aborts, rejecting with its reason, so a request
   * the browser has given up on stops queueing work nobody will read. A task
   * already holding a slot is not interrupted by the gate — cancelling the
   * fetch itself is the caller's to do.
   */
  signal?: AbortSignal;
}

export interface RequestGate {
  /** Run `task` once a slot is free, releasing the slot when it settles. */
  run<T>(task: () => Promise<T>, options?: GateOptions): Promise<T>;
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
  let queued = 0;
  /** Each lane's waiters, oldest first. A lane is present only while waiting. */
  const lanes = new Map<string, Array<() => void>>();
  /** Lanes with waiters, in the order they get their next turn. */
  const turns: string[] = [];

  function acquire(lane: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (inFlight < limit) {
      inFlight += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const admit = () => {
        signal?.removeEventListener("abort", abandon);
        resolve();
      };
      const abandon = () => {
        const waiting = lanes.get(lane);
        const index = waiting?.indexOf(admit) ?? -1;
        if (!waiting || index < 0) return;
        waiting.splice(index, 1);
        queued -= 1;
        if (waiting.length === 0) {
          lanes.delete(lane);
          turns.splice(turns.indexOf(lane), 1);
        }
        reject(signal!.reason);
      };

      const waiting = lanes.get(lane);
      if (waiting) {
        waiting.push(admit);
      } else {
        lanes.set(lane, [admit]);
        turns.push(lane);
      }
      queued += 1;
      signal?.addEventListener("abort", abandon, { once: true });
    });
  }

  function release(): void {
    // Hand the slot straight to the next waiter rather than freeing and
    // reclaiming it, so `inFlight` never dips below the work actually running.
    const lane = turns.shift();
    if (lane === undefined) {
      inFlight -= 1;
      return;
    }
    const waiting = lanes.get(lane)!;
    const next = waiting.shift()!;
    queued -= 1;
    // Back of the line for this lane's next waiter: that is the round robin.
    if (waiting.length > 0) turns.push(lane);
    else lanes.delete(lane);
    next();
  }

  return {
    async run<T>(
      task: () => Promise<T>,
      options: GateOptions = {},
    ): Promise<T> {
      await acquire(options.lane ?? "", options.signal);
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
      return queued;
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
