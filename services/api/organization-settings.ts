import { eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { organizationSettings } from "./db/schema";
import { DEFAULT_REQUIRED_APPROVALS } from "./gitea-client/workspaces";
import { DEFAULT_WORKSPACE_SETTINGS } from "./workspace-settings";

/**
 * What a new binder in an organization starts with.
 *
 * Configuration (ADR 0004), read once when a binder is made and written onto
 * it — its branch protection and its settings row — where each is recorded
 * like any other change to a binder's rules. A binder's rules are always its
 * own answer; this is only where they start.
 */
export interface NewBinderDefaults {
  /** How many approvals a new binder asks for. */
  requiredApprovals: number;
  /** Whether an edit to a change clears the approvals already given. */
  dismissStaleApprovals: boolean;
  /** Whether a change must have every discussion resolved to be published. */
  blockOnUnresolvedThreads: boolean;
}

/** The product's own, for an organization that has chosen none. */
export const PRODUCT_NEW_BINDER_DEFAULTS: NewBinderDefaults = {
  requiredApprovals: DEFAULT_REQUIRED_APPROVALS,
  dismissStaleApprovals: true,
  blockOnUnresolvedThreads: DEFAULT_WORKSPACE_SETTINGS.blockOnUnresolvedThreads,
};

export interface OrganizationSettingsBackend {
  newBinderDefaults(giteaOrgId: number): Promise<NewBinderDefaults>;
  setNewBinderDefaults(params: {
    giteaOrgId: number;
    defaults: Partial<NewBinderDefaults>;
    changedBy: string;
    now?: number;
  }): Promise<NewBinderDefaults>;
}

export class OrganizationSettingsStore implements OrganizationSettingsBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async newBinderDefaults(giteaOrgId: number): Promise<NewBinderDefaults> {
    const row = this.db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.giteaOrgId, giteaOrgId))
      .get();
    if (!row) return { ...PRODUCT_NEW_BINDER_DEFAULTS };
    return {
      requiredApprovals: row.newBinderRequiredApprovals,
      dismissStaleApprovals: row.newBinderDismissStaleApprovals,
      blockOnUnresolvedThreads: row.newBinderBlockOnUnresolvedThreads,
    };
  }

  /** Change some of them, keeping the rest. Returns what they are now. */
  async setNewBinderDefaults(params: {
    giteaOrgId: number;
    defaults: Partial<NewBinderDefaults>;
    changedBy: string;
    now?: number;
  }): Promise<NewBinderDefaults> {
    const { giteaOrgId, defaults, changedBy } = params;
    const now = params.now ?? Math.floor(Date.now() / 1000);
    const next = { ...(await this.newBinderDefaults(giteaOrgId)), ...defaults };
    const values = {
      newBinderRequiredApprovals: next.requiredApprovals,
      newBinderDismissStaleApprovals: next.dismissStaleApprovals,
      newBinderBlockOnUnresolvedThreads: next.blockOnUnresolvedThreads,
      updatedBy: changedBy,
      updatedAt: now,
    };
    this.db
      .insert(organizationSettings)
      .values({ giteaOrgId, ...values })
      .onConflictDoUpdate({
        target: organizationSettings.giteaOrgId,
        set: values,
      })
      .run();
    return next;
  }
}

// Lazy so importing this module never opens the SQLite file.
class LazyOrganizationSettingsStore implements OrganizationSettingsBackend {
  private _store: OrganizationSettingsBackend | null = null;

  private get store(): OrganizationSettingsBackend {
    if (!this._store) this._store = new OrganizationSettingsStore();
    return this._store;
  }

  newBinderDefaults(giteaOrgId: number): Promise<NewBinderDefaults> {
    return this.store.newBinderDefaults(giteaOrgId);
  }

  setNewBinderDefaults(
    params: Parameters<OrganizationSettingsBackend["setNewBinderDefaults"]>[0],
  ): Promise<NewBinderDefaults> {
    return this.store.setNewBinderDefaults(params);
  }
}

export const organizationSettingsStore: OrganizationSettingsBackend =
  new LazyOrganizationSettingsStore();
