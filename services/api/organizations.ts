import { eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { organizations } from "./db/schema";

/**
 * The local half of an organization.
 *
 * The organization itself is a Gitea org: its identity, its members, who owns
 * it and what they can do are Gitea's and are never mirrored here. This store
 * holds only what Gitea has no primitive for — the trial window today, the
 * Stripe linkage next — keyed on the Gitea org id, because Gitea renames
 * organizations and a name key breaks silently when it does.
 */

/** #369: fourteen days, no card. */
export const TRIAL_DAYS = 14;

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface OrganizationRecord {
  giteaOrgId: number;
  /** Denormalized from Gitea for display. Never an identifier. */
  name: string;
  createdBy: string;
  createdAt: number;
  /** Unix seconds, or null for an organization with no trial. */
  trialEndsAt: number | null;
}

export interface OrganizationBackend {
  get(giteaOrgId: number): Promise<OrganizationRecord | null>;
  getByName(name: string): Promise<OrganizationRecord | null>;
  upsert(record: OrganizationRecord): Promise<void>;
  list(): Promise<OrganizationRecord[]>;
  /** Every organization this person created. Decides who gets a trial. */
  listByCreator(createdBy: string): Promise<OrganizationRecord[]>;
}

/** The trial window that starts at signup, in Unix seconds. */
export function trialEndsAtFrom(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + TRIAL_DAYS * SECONDS_PER_DAY;
}

/** Whether an organization's local trial is still running. */
export function isInTrial(
  record: OrganizationRecord | null,
  nowMs: number = Date.now(),
): boolean {
  if (!record || record.trialEndsAt === null) return false;
  return record.trialEndsAt > Math.floor(nowMs / 1000);
}

export class OrganizationStore implements OrganizationBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async get(giteaOrgId: number): Promise<OrganizationRecord | null> {
    const row = this.db
      .select()
      .from(organizations)
      .where(eq(organizations.giteaOrgId, giteaOrgId))
      .get();
    return row ?? null;
  }

  /**
   * Lookup by the denormalized name. Only for paths that have a name and no id
   * — a rename Bindersnap did not perform leaves this stale until the next
   * write, and the id is always the safer question.
   */
  async getByName(name: string): Promise<OrganizationRecord | null> {
    const row = this.db
      .select()
      .from(organizations)
      .where(eq(organizations.name, name))
      .get();
    return row ?? null;
  }

  async upsert(record: OrganizationRecord): Promise<void> {
    this.db
      .insert(organizations)
      .values(record)
      .onConflictDoUpdate({
        target: organizations.giteaOrgId,
        set: {
          name: record.name,
          createdBy: record.createdBy,
          createdAt: record.createdAt,
          trialEndsAt: record.trialEndsAt,
        },
      })
      .run();
  }

  async listByCreator(createdBy: string): Promise<OrganizationRecord[]> {
    return this.db
      .select()
      .from(organizations)
      .where(eq(organizations.createdBy, createdBy))
      .all();
  }

  async list(): Promise<OrganizationRecord[]> {
    return this.db.select().from(organizations).all();
  }
}

// Lazy so importing this module never opens the SQLite file.
class LazyOrganizationStore implements OrganizationBackend {
  private _store: OrganizationBackend | null = null;

  private get store(): OrganizationBackend {
    if (!this._store) {
      this._store = new OrganizationStore();
    }
    return this._store;
  }

  get(giteaOrgId: number): Promise<OrganizationRecord | null> {
    return this.store.get(giteaOrgId);
  }

  getByName(name: string): Promise<OrganizationRecord | null> {
    return this.store.getByName(name);
  }

  upsert(record: OrganizationRecord): Promise<void> {
    return this.store.upsert(record);
  }

  listByCreator(createdBy: string): Promise<OrganizationRecord[]> {
    return this.store.listByCreator(createdBy);
  }

  list(): Promise<OrganizationRecord[]> {
    return this.store.list();
  }
}

export const organizationStore = new LazyOrganizationStore();

/**
 * Record an organization created at signup, with its trial running.
 *
 * Idempotent on the Gitea org id: re-provisioning an organization that already
 * has a row must not restart its trial, or a customer could reset the clock by
 * re-running signup.
 */
export async function recordProvisionedOrganization(params: {
  giteaOrgId: number;
  name: string;
  createdBy: string;
  now?: number;
  store?: OrganizationBackend;
}): Promise<OrganizationRecord> {
  const store = params.store ?? organizationStore;
  const now = params.now ?? Date.now();

  const existing = await store.get(params.giteaOrgId);
  const record: OrganizationRecord = {
    giteaOrgId: params.giteaOrgId,
    name: params.name,
    createdBy: existing?.createdBy ?? params.createdBy,
    createdAt: existing?.createdAt ?? Math.floor(now / 1000),
    trialEndsAt:
      existing?.trialEndsAt ??
      (await resolveTrialEnd(store, params.createdBy, now)),
  };

  await store.upsert(record);
  return record;
}

/**
 * The trial goes to a person's **first** organization, not to every one they
 * create.
 *
 * Creating an organization is self-serve, and a trial is 14 days of the
 * product for free — so a per-organization trial is a per-afternoon trial for
 * anyone willing to click twice. Their second organization is real (a
 * consultant's second client, a company splitting a department out) and can be
 * created freely; it just has to be paid for to author in.
 *
 * Re-provisioning never reaches here: an organization that already has a
 * record keeps whatever trial it was given.
 */
async function resolveTrialEnd(
  store: OrganizationBackend,
  createdBy: string,
  nowMs: number,
): Promise<number | null> {
  const alreadyCreated = await store.listByCreator(createdBy);
  return alreadyCreated.length === 0 ? trialEndsAtFrom(nowMs) : null;
}
