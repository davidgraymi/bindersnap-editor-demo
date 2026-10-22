import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { emailPreferences } from "./db/schema";

/**
 * Which change emails a person gets (issue #665).
 *
 * Settings, so they live in SQLite (ADR 0004), keyed by login. Every topic is
 * on until the person turns it off — from their settings page, or from the
 * unsubscribe link in any email, which needs no sign-in.
 */

export const EMAIL_TOPICS = [
  "reviewRequested",
  "changesRequested",
  "readyToPublish",
  "published",
] as const;

export type EmailTopic = (typeof EMAIL_TOPICS)[number];
export type EmailPreferences = Record<EmailTopic, boolean>;

export const ALL_ON: EmailPreferences = {
  reviewRequested: true,
  changesRequested: true,
  readyToPublish: true,
  published: true,
};

/** Read a preferences body leniently: unknown keys ignored, non-booleans refused. */
export function parsePreferences(
  value: unknown,
): Partial<EmailPreferences> | null {
  if (!value || typeof value !== "object") return null;
  const out: Partial<EmailPreferences> = {};
  for (const topic of EMAIL_TOPICS) {
    const entry = (value as Record<string, unknown>)[topic];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") return null;
    out[topic] = entry;
  }
  return out;
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

export class EmailPreferenceStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  private row(username: string) {
    return (
      this.db
        .select()
        .from(emailPreferences)
        .where(eq(emailPreferences.username, key(username)))
        .get() ?? null
    );
  }

  get(username: string): EmailPreferences {
    const row = this.row(username);
    if (!row) return { ...ALL_ON };
    return {
      reviewRequested: row.reviewRequested,
      changesRequested: row.changesRequested,
      readyToPublish: row.readyToPublish,
      published: row.published,
    };
  }

  wants(username: string, topic: EmailTopic): boolean {
    return this.get(username)[topic];
  }

  set(
    username: string,
    changes: Partial<EmailPreferences>,
    now = Date.now(),
  ): EmailPreferences {
    const next = { ...this.get(username), ...changes };
    this.db
      .insert(emailPreferences)
      .values({
        username: key(username),
        ...next,
        unsubscribeToken: this.tokenFor(username),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: emailPreferences.username,
        set: { ...next, updatedAt: now },
      })
      .run();
    return next;
  }

  /** This person's unsubscribe token, made the first time it is asked for. */
  tokenFor(username: string, now = Date.now()): string {
    const existing = this.row(username);
    if (existing) return existing.unsubscribeToken;
    const token = randomBytes(24).toString("base64url");
    this.db
      .insert(emailPreferences)
      .values({
        username: key(username),
        ...ALL_ON,
        unsubscribeToken: token,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    return this.row(username)!.unsubscribeToken;
  }

  /** Every topic off, by the token in an email. The login, or null. */
  unsubscribe(token: string, now = Date.now()): string | null {
    const row = this.db
      .update(emailPreferences)
      .set({
        reviewRequested: false,
        changesRequested: false,
        readyToPublish: false,
        published: false,
        updatedAt: now,
      })
      .where(eq(emailPreferences.unsubscribeToken, token))
      .returning({ username: emailPreferences.username })
      .get();
    return row?.username ?? null;
  }
}

let store: EmailPreferenceStore | null = null;

export function emailPreferenceStore(): EmailPreferenceStore {
  store ??= new EmailPreferenceStore();
  return store;
}
