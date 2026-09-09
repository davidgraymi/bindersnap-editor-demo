import { and, desc, eq } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { settingsEvents, workspaceSettings } from "./db/schema";

/**
 * A binder's review policy — the rules Gitea's branch protection cannot express.
 *
 * **This replaces the `bindersnap-config` branch**, which ADR 0004's migration
 * step 5 asks to retire. That file paid every cost of putting configuration in
 * git and bought one property: a commit recording who changed the policy and
 * when. It is kept — as `settings_events`, indexed, in one query — and the
 * costs are not:
 *
 * - Every read was a network round trip to Gitea with no local index.
 * - Every write was two to four API calls plus permanent git objects, on a
 *   dedicated branch that existed only because `main` is protected.
 * - It had no types and no constraints, so `parseReviewSettings` had to
 *   tolerate a malformed file — and it degraded **silently to the permissive
 *   policy**, which meant a corrupt byte turned a control off with nothing said.
 *
 * That last one is the reason this is a table rather than a nicer file. A
 * control that fails open and says nothing is the failure mode ADR 0004 spends
 * a paragraph forbidding elsewhere.
 *
 * **What is not here is the evidence.** What the policy *was* when a version
 * was published is stamped into that version's annotated tag — immutable,
 * attached to the exact event, needing no join against historical settings, and
 * readable from a bare clone with no application running. Losing this database
 * costs the administrative trail and not one fact a surveyor could ask for.
 */

/**
 * The rules a binder is under that Gitea's branch protection cannot express.
 *
 * One today. The shape is kept as a named type rather than a bare boolean so
 * that adding a second rule is a field rather than a signature change through
 * every gate that reads it.
 */
export interface ReviewSettings {
  /** Refuse to publish while any review thread is still unresolved. */
  blockOnUnresolvedThreads: boolean;
}

export interface WorkspaceSettingsRecord {
  /** The Gitea repository id. Stable across renames, unlike the name. */
  giteaRepoId: number;
  /** Denormalized from Gitea for display. Never an identifier. */
  organization: string;
  workspace: string;
  /** Refuse to publish while any review thread is still unresolved. */
  blockOnUnresolvedThreads: boolean;
  updatedAt: number;
}

/**
 * What a binder is under when nobody has said otherwise.
 *
 * Permissive, deliberately, and it is the one default worth arguing about: a
 * binder that blocked publishing on unresolved threads by default would stop
 * every first publish for a reason nobody had chosen. The setting exists to be
 * turned **on** by a customer who wants it.
 */
export const DEFAULT_WORKSPACE_SETTINGS: Omit<
  WorkspaceSettingsRecord,
  "giteaRepoId" | "organization" | "workspace" | "updatedAt"
> = {
  blockOnUnresolvedThreads: false,
};

/** One recorded change to a binder's rules. Append-only. */
export interface SettingsEventRecord {
  giteaRepoId: number;
  setting: string;
  /** Null the first time a setting is written. */
  previousValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: number;
}

export interface WorkspaceSettingsBackend {
  get(giteaRepoId: number): Promise<WorkspaceSettingsRecord | null>;
  /**
   * Write the settings and record what changed, in that order.
   *
   * Returns the events it recorded, so a caller can log or show them without
   * reading the table back. A write that changes nothing records nothing —
   * an administrative trail full of "set X to X" is a trail nobody reads.
   */
  set(params: {
    giteaRepoId: number;
    organization: string;
    workspace: string;
    settings: Partial<
      Pick<WorkspaceSettingsRecord, "blockOnUnresolvedThreads">
    >;
    changedBy: string;
    now?: number;
  }): Promise<SettingsEventRecord[]>;
  /** Newest first. For the administrative view, not for any gate. */
  history(giteaRepoId: number, limit?: number): Promise<SettingsEventRecord[]>;
}

export class WorkspaceSettingsStore implements WorkspaceSettingsBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async get(giteaRepoId: number): Promise<WorkspaceSettingsRecord | null> {
    const row = this.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.giteaRepoId, giteaRepoId))
      .get();
    return row ?? null;
  }

  async set(params: {
    giteaRepoId: number;
    organization: string;
    workspace: string;
    settings: Partial<
      Pick<WorkspaceSettingsRecord, "blockOnUnresolvedThreads">
    >;
    changedBy: string;
    now?: number;
  }): Promise<SettingsEventRecord[]> {
    const { giteaRepoId, organization, workspace, settings, changedBy } =
      params;
    const now = params.now ?? Math.floor(Date.now() / 1000);

    const current = await this.get(giteaRepoId);
    const before =
      current?.blockOnUnresolvedThreads ??
      DEFAULT_WORKSPACE_SETTINGS.blockOnUnresolvedThreads;
    const after = settings.blockOnUnresolvedThreads ?? before;

    this.db
      .insert(workspaceSettings)
      .values({
        giteaRepoId,
        organization,
        workspace,
        blockOnUnresolvedThreads: after,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspaceSettings.giteaRepoId,
        set: {
          // The names are refreshed on every write, so a rename Bindersnap did
          // not perform stops being stale the next time anybody touches the
          // rules. The id is what everything is keyed on either way.
          organization,
          workspace,
          blockOnUnresolvedThreads: after,
          updatedAt: now,
        },
      })
      .run();

    // Nothing changed, so there is nothing to record. A trail of no-ops is a
    // trail nobody reads, and the row above is still refreshed either way.
    if (after === before && current !== null) return [];

    const event: SettingsEventRecord = {
      giteaRepoId,
      setting: "blockOnUnresolvedThreads",
      previousValue: current === null ? null : String(before),
      newValue: String(after),
      changedBy,
      changedAt: now,
    };

    this.db.insert(settingsEvents).values(event).run();

    return [event];
  }

  async history(
    giteaRepoId: number,
    limit = 50,
  ): Promise<SettingsEventRecord[]> {
    return this.db
      .select({
        giteaRepoId: settingsEvents.giteaRepoId,
        setting: settingsEvents.setting,
        previousValue: settingsEvents.previousValue,
        newValue: settingsEvents.newValue,
        changedBy: settingsEvents.changedBy,
        changedAt: settingsEvents.changedAt,
      })
      .from(settingsEvents)
      .where(eq(settingsEvents.giteaRepoId, giteaRepoId))
      .orderBy(desc(settingsEvents.changedAt), desc(settingsEvents.id))
      .limit(limit)
      .all();
  }

  /** Every recorded change to one setting. Used by the tests, not the app. */
  async historyOf(
    giteaRepoId: number,
    setting: string,
  ): Promise<SettingsEventRecord[]> {
    return this.db
      .select({
        giteaRepoId: settingsEvents.giteaRepoId,
        setting: settingsEvents.setting,
        previousValue: settingsEvents.previousValue,
        newValue: settingsEvents.newValue,
        changedBy: settingsEvents.changedBy,
        changedAt: settingsEvents.changedAt,
      })
      .from(settingsEvents)
      .where(
        and(
          eq(settingsEvents.giteaRepoId, giteaRepoId),
          eq(settingsEvents.setting, setting),
        ),
      )
      .orderBy(desc(settingsEvents.changedAt), desc(settingsEvents.id))
      .all();
  }
}

// Lazy so importing this module never opens the SQLite file.
class LazyWorkspaceSettingsStore implements WorkspaceSettingsBackend {
  private _store: WorkspaceSettingsBackend | null = null;

  private get store(): WorkspaceSettingsBackend {
    if (!this._store) {
      this._store = new WorkspaceSettingsStore();
    }
    return this._store;
  }

  get(giteaRepoId: number): Promise<WorkspaceSettingsRecord | null> {
    return this.store.get(giteaRepoId);
  }

  set(
    params: Parameters<WorkspaceSettingsBackend["set"]>[0],
  ): Promise<SettingsEventRecord[]> {
    return this.store.set(params);
  }

  history(giteaRepoId: number, limit?: number): Promise<SettingsEventRecord[]> {
    return this.store.history(giteaRepoId, limit);
  }
}

export const workspaceSettingsStore: WorkspaceSettingsBackend =
  new LazyWorkspaceSettingsStore();
