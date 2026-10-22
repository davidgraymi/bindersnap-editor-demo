import { and, desc, eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { legalAgreements } from "./db/schema";

/**
 * The record of agreements to the Terms (#666): people for themselves, and
 * owners for their organizations.
 *
 * Append-only: a later version is a new row, never an edit to the old one,
 * so the question "what had they agreed to on this date?" always has an
 * answer.
 */

export interface LegalAgreement {
  username: string;
  userId: number | null;
  version: string;
  acceptedAt: number;
  scope: "person" | "organization";
  organizationId: number | null;
  organizationName: string | null;
}

export interface NewLegalAgreement {
  username: string;
  userId: number | null;
  version: string;
  organization?: { id: number; name: string };
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

const columns = {
  username: legalAgreements.username,
  userId: legalAgreements.userId,
  version: legalAgreements.version,
  acceptedAt: legalAgreements.acceptedAt,
  scope: legalAgreements.scope,
  organizationId: legalAgreements.organizationId,
  organizationName: legalAgreements.organizationName,
};

export class LegalAgreementStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  record(agreement: NewLegalAgreement, now = Date.now()): void {
    this.db
      .insert(legalAgreements)
      .values({
        username: key(agreement.username),
        userId: agreement.userId,
        version: agreement.version,
        acceptedAt: now,
        scope: agreement.organization ? "organization" : "person",
        organizationId: agreement.organization?.id ?? null,
        organizationName: agreement.organization?.name ?? null,
      })
      .run();
  }

  /** Every agreement this login has made, for itself or not, newest first. */
  history(username: string): LegalAgreement[] {
    return this.db
      .select(columns)
      .from(legalAgreements)
      .where(eq(legalAgreements.username, key(username)))
      .orderBy(desc(legalAgreements.acceptedAt), desc(legalAgreements.id))
      .all() as LegalAgreement[];
  }

  /** The newest version this login agreed to for itself, if any. */
  latestPersonVersion(username: string): string | null {
    const row = this.db
      .select({ version: legalAgreements.version })
      .from(legalAgreements)
      .where(
        and(
          eq(legalAgreements.username, key(username)),
          eq(legalAgreements.scope, "person"),
        ),
      )
      .orderBy(desc(legalAgreements.version))
      .limit(1)
      .get();
    return row?.version ?? null;
  }

  /** The newest version anybody accepted for this organization, if any. */
  latestOrganizationVersion(organizationId: number): string | null {
    const row = this.db
      .select({ version: legalAgreements.version })
      .from(legalAgreements)
      .where(
        and(
          eq(legalAgreements.organizationId, organizationId),
          eq(legalAgreements.scope, "organization"),
        ),
      )
      .orderBy(desc(legalAgreements.version))
      .limit(1)
      .get();
    return row?.version ?? null;
  }
}

let store: LegalAgreementStore | null = null;

export function legalAgreementStore(): LegalAgreementStore {
  store ??= new LegalAgreementStore();
  return store;
}
