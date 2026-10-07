import { desc, eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { legalAgreements } from "./db/schema";

/**
 * The record of a person agreeing to the Terms and Privacy Policy (#666).
 *
 * Append-only: a later version is a new row, never an edit to the old one,
 * so the question "what had they agreed to on this date?" always has an
 * answer.
 */

export interface LegalAgreement {
  username: string;
  version: string;
  acceptedAt: number;
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

export class LegalAgreementStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  record(username: string, version: string, now = Date.now()): void {
    this.db
      .insert(legalAgreements)
      .values({ username: key(username), version, acceptedAt: now })
      .run();
  }

  /** Every agreement this login has made, newest first. */
  history(username: string): LegalAgreement[] {
    return this.db
      .select({
        username: legalAgreements.username,
        version: legalAgreements.version,
        acceptedAt: legalAgreements.acceptedAt,
      })
      .from(legalAgreements)
      .where(eq(legalAgreements.username, key(username)))
      .orderBy(desc(legalAgreements.acceptedAt), desc(legalAgreements.id))
      .all();
  }
}

let store: LegalAgreementStore | null = null;

export function legalAgreementStore(): LegalAgreementStore {
  store ??= new LegalAgreementStore();
  return store;
}
