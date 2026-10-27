import { desc, eq } from "drizzle-orm";

import {
  cleanSignupSource,
  type SignupSource,
} from "../../packages/utils/signupSource";
import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { signupSources } from "./db/schema";

/**
 * Where each account's signup came from, kept by us rather than sent to
 * Google: the Privacy Policy promises Google Analytics never sees the app or
 * an account. Written once, at signup; deleted with the account.
 */

export interface SignupSourceRow extends SignupSource {
  username: string;
  invited: boolean;
  createdAt: number;
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

export class SignupSourceStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /** `source` is cleaned here too: it comes straight from the request. */
  record(
    username: string,
    source: unknown,
    invited: boolean,
    now = Date.now(),
  ): void {
    const clean = cleanSignupSource(source) ?? {};
    this.db
      .insert(signupSources)
      .values({
        username: key(username),
        entryPath: clean.entryPath ?? null,
        fromPath: clean.fromPath ?? null,
        referrerHost: clean.referrerHost ?? null,
        utmSource: clean.utmSource ?? null,
        utmMedium: clean.utmMedium ?? null,
        utmCampaign: clean.utmCampaign ?? null,
        invited,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  get(username: string): SignupSourceRow | null {
    const row = this.db
      .select()
      .from(signupSources)
      .where(eq(signupSources.username, key(username)))
      .get();
    return row ? toRow(row) : null;
  }

  /** Every signup on record, newest first. */
  list(): SignupSourceRow[] {
    return this.db
      .select()
      .from(signupSources)
      .orderBy(desc(signupSources.createdAt))
      .all()
      .map(toRow);
  }

  forget(username: string): void {
    this.db
      .delete(signupSources)
      .where(eq(signupSources.username, key(username)))
      .run();
  }
}

function toRow(row: typeof signupSources.$inferSelect): SignupSourceRow {
  return {
    username: row.username,
    ...(cleanSignupSource(row) ?? {}),
    invited: row.invited,
    createdAt: row.createdAt,
  };
}

let store: SignupSourceStore | null = null;

export function signupSourceStore(): SignupSourceStore {
  store ??= new SignupSourceStore();
  return store;
}
