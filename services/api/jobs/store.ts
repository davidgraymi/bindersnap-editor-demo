import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { config } from "../config";
import { openSqliteDb, type SqliteDb } from "../db/client";
import { jobs } from "../db/schema";

/**
 * Durable intent for multi-step Gitea writes.
 *
 * Publishing is a merge and then a tag per document, and Gitea has no
 * transaction across them. Run as a chain of awaits inside a request, a
 * deploy or a crash between the merge and the tags left a change merged with
 * no version — and the next Publish was refused, because the change was
 * already merged. The fix is the one the Stripe webhook already uses: write
 * down what is going to happen before the first irreversible step, make every
 * step safe to repeat, and keep going until it is done.
 *
 * One API process on one host (ADR 0003), so this is a table in the API's own
 * SQLite database rather than a queue service. The row is committed before
 * Gitea is touched, the file is replicated by Litestream, and moving to SQS
 * later means feeding it from this table — the outbox it would need anyway.
 */

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface JobRecord<Plan = unknown> {
  id: string;
  kind: string;
  groupKey: string;
  subject: string;
  idempotencyKey: string | null;
  plan: Plan;
  status: JobStatus;
  attempts: number;
  leaseUntil: number | null;
  lastError: string | null;
  result: unknown;
  createdBy: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** How long a run holds a job before another may take it over. */
export const JOB_LEASE_MS = 2 * 60_000;
/** Runs a job gets before it stops in `failed` for a person to look at. */
export const JOB_MAX_ATTEMPTS = 5;
/** How long a finished job is kept, for debugging. Nothing reads it after. */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;

function toRecord(row: typeof jobs.$inferSelect): JobRecord {
  return {
    ...row,
    status: row.status as JobStatus,
    plan: JSON.parse(row.plan) as unknown,
    result: row.result === null ? null : (JSON.parse(row.result) as unknown),
  };
}

export class JobStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /**
   * Record a job, or hand back the one this idempotency key already made.
   *
   * A double click, or a browser retrying a request that timed out, must not
   * start a second publish of the same change.
   */
  create<Plan>(params: {
    kind: string;
    groupKey: string;
    subject: string;
    plan: Plan;
    createdBy: string;
    sessionId?: string | null;
    idempotencyKey?: string | null;
    now?: number;
  }): JobRecord<Plan> {
    const now = params.now ?? Date.now();
    const key = params.idempotencyKey ?? null;
    if (key !== null) {
      const existing = this.byIdempotencyKey(key);
      if (existing) return existing as JobRecord<Plan>;
    }

    const id = randomUUID();
    this.db
      .insert(jobs)
      .values({
        id,
        kind: params.kind,
        groupKey: params.groupKey,
        subject: params.subject,
        idempotencyKey: key,
        plan: JSON.stringify(params.plan),
        status: "pending",
        attempts: 0,
        leaseUntil: null,
        lastError: null,
        result: null,
        createdBy: params.createdBy,
        sessionId: params.sessionId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id)! as JobRecord<Plan>;
  }

  get(id: string): JobRecord | null {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? toRecord(row) : null;
  }

  byIdempotencyKey(key: string): JobRecord | null {
    const row = this.db
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, key))
      .get();
    return row ? toRecord(row) : null;
  }

  /** The unfinished job acting on this subject, if there is one. */
  openFor(groupKey: string, subject: string): JobRecord | null {
    const row = this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.groupKey, groupKey),
          eq(jobs.subject, subject),
          inArray(jobs.status, ["pending", "running", "failed"]),
        ),
      )
      .get();
    return row ? toRecord(row) : null;
  }

  /**
   * Take a job to run: one that is pending, or running on a lease that lapsed
   * because whatever held it died. Returns null if somebody else has it.
   */
  claim(id: string, now = Date.now()): JobRecord | null {
    const claimed = this.db
      .update(jobs)
      .set({
        status: "running",
        leaseUntil: now + JOB_LEASE_MS,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, id),
          or(
            eq(jobs.status, "pending"),
            eq(jobs.status, "failed"),
            and(eq(jobs.status, "running"), lt(jobs.leaseUntil, now)),
          ),
        ),
      )
      .returning()
      .get();
    return claimed ? toRecord(claimed) : null;
  }

  /** Jobs a runner should pick up: pending, or abandoned mid-run. */
  runnable(now = Date.now()): JobRecord[] {
    return this.db
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "pending"), isNull(jobs.leaseUntil)),
          and(eq(jobs.status, "pending"), lt(jobs.leaseUntil, now)),
          and(eq(jobs.status, "running"), lt(jobs.leaseUntil, now)),
        ),
      )
      .orderBy(jobs.createdAt)
      .all()
      .map(toRecord);
  }

  complete(id: string, result: unknown, now = Date.now()): void {
    this.db
      .update(jobs)
      .set({
        status: "done",
        result: JSON.stringify(result ?? null),
        lastError: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, id))
      .run();
  }

  /**
   * A run that did not finish. It goes back to `pending` with a backoff, until
   * it has had its attempts — then `failed`, where it waits for a person.
   * `permanent` skips the retries: a conflict will not resolve by waiting.
   */
  fail(
    id: string,
    error: string,
    options: { permanent?: boolean; now?: number } = {},
  ): JobRecord | null {
    const now = options.now ?? Date.now();
    const job = this.get(id);
    if (!job) return null;
    const attempts = job.attempts + 1;
    const giveUp = options.permanent || attempts >= JOB_MAX_ATTEMPTS;
    this.db
      .update(jobs)
      .set({
        status: giveUp ? "failed" : "pending",
        attempts,
        lastError: error,
        // Backoff: 10s, 20s, 40s… before the runner tries again.
        leaseUntil: giveUp ? null : now + 10_000 * 2 ** (attempts - 1),
        updatedAt: now,
      })
      .where(eq(jobs.id, id))
      .run();
    return this.get(id);
  }

  /**
   * Drop a job whose intent came to nothing: it failed before its first
   * irreversible step, so there is nothing to finish and nothing to keep.
   */
  delete(id: string): void {
    this.db.delete(jobs).where(eq(jobs.id, id)).run();
  }

  /** Forget finished jobs past their retention. */
  prune(now = Date.now()): void {
    this.db
      .delete(jobs)
      .where(
        and(
          eq(jobs.status, "done"),
          lt(jobs.updatedAt, now - JOB_RETENTION_MS),
        ),
      )
      .run();
  }
}

let store: { path: string; jobs: JobStore } | null = null;

/**
 * Opened on first use, so importing this does not touch the database — and
 * opened again if the configured database moves, which tests do.
 */
export function jobStore(): JobStore {
  if (!store || store.path !== config.sessionsDbPath) {
    store = {
      path: config.sessionsDbPath,
      jobs: new JobStore(config.sessionsDbPath),
    };
  }
  return store.jobs;
}

/** For tests. */
export function setJobStore(next: JobStore | null): void {
  store = next ? { path: config.sessionsDbPath, jobs: next } : null;
}

const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with nothing else in this group running.
 *
 * **One publish at a time per binder** makes version numbers correct by
 * construction: two publishes planned at once both read v3 and both chose v4,
 * and the second tag write failed after its merge had landed. In process,
 * because there is one API process (ADR 0003) — the same reason the request
 * gate is.
 */
export async function withGroupLock<T>(
  groupKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(groupKey) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(groupKey, tail);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(groupKey) === tail) tails.delete(groupKey);
  }
}
