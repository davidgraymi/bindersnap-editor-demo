import { logger } from "../logger";
import { jobStore, withGroupLock, type JobRecord } from "./store";

/**
 * Finishes jobs that the request which started them could not.
 *
 * A job normally runs inline, inside the request that recorded it, and is done
 * before the response goes out. This is for the rest: the process died
 * mid-run (a deploy replaces the API container on every push to `main`), or a
 * step failed in a way worth trying again. On startup, and then every so
 * often, it takes each runnable job and runs it again under its group's lock.
 * The steps are safe to repeat — see `publish.ts` — which is what lets this
 * be this simple.
 */
export function startJobRunner(params: {
  run: Record<string, (job: JobRecord) => Promise<void>>;
  intervalMs?: number;
}): () => void {
  const { run, intervalMs = 15_000 } = params;
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const store = jobStore();
      store.prune();
      for (const job of store.runnable()) {
        const handler = run[job.kind];
        if (!handler) continue;
        await withGroupLock(job.groupKey, () => handler(job)).catch((err) => {
          logger.error("A job runner pass failed", {
            jobId: job.id,
            kind: job.kind,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      logger.error("The job runner could not read its jobs", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
