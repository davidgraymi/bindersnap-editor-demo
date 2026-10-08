import { randomUUID } from "node:crypto";

import { and, eq, inArray, lt, lte } from "drizzle-orm";

import { config } from "../config";
import { openSqliteDb, type SqliteDb } from "../db/client";
import { emailOutbox } from "../db/schema";

export type EmailStatus = "pending" | "sent" | "failed";

export interface QueuedEmail {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string | null;
  status: EmailStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: number;
  sentAt: number | null;
}

/** Tries before an email stops in `failed`: about a day and a half, in all. */
export const EMAIL_MAX_ATTEMPTS = 10;
/** Kept for support questions ("did it send?"), then forgotten. */
export const EMAIL_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** 1, 2, 4 … minutes, capped at four hours. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 4 * 60 * 60_000);
}

function toRecord(row: typeof emailOutbox.$inferSelect): QueuedEmail {
  return { ...row, status: row.status as EmailStatus };
}

export class EmailOutbox {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /**
   * Queue an email. With an idempotency key already used, nothing is queued
   * and the earlier email is handed back.
   */
  enqueue(params: {
    kind: string;
    recipient: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey?: string | null;
    now?: number;
  }): QueuedEmail {
    const now = params.now ?? Date.now();
    const key = params.idempotencyKey ?? null;
    const id = randomUUID();
    const inserted = this.db
      .insert(emailOutbox)
      .values({
        id,
        kind: params.kind,
        recipient: params.recipient,
        subject: params.subject,
        html: params.html,
        text: params.text,
        idempotencyKey: key,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        providerMessageId: null,
        createdAt: now,
        sentAt: null,
      })
      .onConflictDoNothing()
      .returning()
      .get();
    if (inserted) return toRecord(inserted);
    return this.byIdempotencyKey(key!)!;
  }

  get(id: string): QueuedEmail | null {
    const row = this.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, id))
      .get();
    return row ? toRecord(row) : null;
  }

  byIdempotencyKey(key: string): QueuedEmail | null {
    const row = this.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, key))
      .get();
    return row ? toRecord(row) : null;
  }

  /** Pending emails whose turn has come, oldest first. */
  due(now = Date.now(), limit = 25): QueuedEmail[] {
    return this.db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.status, "pending"),
          lte(emailOutbox.nextAttemptAt, now),
        ),
      )
      .orderBy(emailOutbox.nextAttemptAt)
      .limit(limit)
      .all()
      .map(toRecord);
  }

  /** Sent. The body goes: its links may be credentials. */
  markSent(id: string, providerMessageId: string, now = Date.now()): void {
    this.db
      .update(emailOutbox)
      .set({
        status: "sent",
        html: "",
        text: "",
        providerMessageId,
        lastError: null,
        sentAt: now,
        attempts: this.get(id)!.attempts + 1,
      })
      .where(eq(emailOutbox.id, id))
      .run();
  }

  /**
   * Not sent. Tried again later, unless the error is permanent or it has had
   * its tries — then it stops in `failed`, body blanked like a sent one.
   */
  markFailed(
    id: string,
    error: string,
    permanent: boolean,
    now = Date.now(),
  ): QueuedEmail {
    const attempts = this.get(id)!.attempts + 1;
    const giveUp = permanent || attempts >= EMAIL_MAX_ATTEMPTS;
    this.db
      .update(emailOutbox)
      .set(
        giveUp
          ? { status: "failed", attempts, lastError: error, html: "", text: "" }
          : {
              attempts,
              lastError: error,
              nextAttemptAt: now + retryDelayMs(attempts),
            },
      )
      .where(eq(emailOutbox.id, id))
      .run();
    return this.get(id)!;
  }

  /** Forget finished emails past the retention window. */
  prune(now = Date.now()): void {
    this.db
      .delete(emailOutbox)
      .where(
        and(
          inArray(emailOutbox.status, ["sent", "failed"]),
          lt(emailOutbox.createdAt, now - EMAIL_RETENTION_MS),
        ),
      )
      .run();
  }
}

let outbox: EmailOutbox | null = null;

export function emailOutboxStore(): EmailOutbox {
  outbox ??= new EmailOutbox();
  return outbox;
}
