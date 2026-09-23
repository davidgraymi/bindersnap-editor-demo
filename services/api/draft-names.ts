import { and, eq, inArray } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { binderDrafts } from "./db/schema";

/**
 * What a person called each draft they have open in a binder.
 *
 * **The draft is the branch; this is only its label.** Every act is a commit
 * on `draft/<username>/<stamp>`, and that is where the work is — permanently,
 * in Gitea, per ADR 0004. What that rule has no home for is a sentence
 * somebody typed about work nobody has been asked to look at yet, and a person
 * with three drafts needs one: "resume the one from Tuesday" is unanswerable
 * when all three are called `draft/alice/…`.
 *
 * See `binderDrafts` in `db/schema.ts` for why this is a table rather than
 * something in the repository. The short version: there is no Gitea primitive
 * for a label on a branch, a draft's name is not evidence, and the moment the
 * draft is proposed the name becomes the change request's title — which is in
 * Gitea and permanent.
 *
 * **Names are a convenience and never a gate.** Every route that acts on a
 * draft still checks the branch against Gitea through `resolveOwnDraftBranch`.
 * A name that cannot be read costs a label; it can never widen what somebody
 * may do.
 */

/** A draft's label, as stored. */
export interface DraftNameRecord {
  branch: string;
  name: string;
  /** True when a person wrote this name, false when it took its date. */
  authored: boolean;
  owner: string;
  updatedAt: number;
}

/** How long a draft's name may be. Long enough for a sentence, bounded. */
export const MAX_DRAFT_NAME_LENGTH = 120;

/**
 * Tidy a name somebody typed, or refuse it.
 *
 * Refused rather than defaulted: a draft with a name is the whole point of
 * this, and silently calling it "Untitled" would put the caller's mistake in
 * front of them later as a label they did not write.
 */
export function normalizeDraftName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, MAX_DRAFT_NAME_LENGTH);
}

export interface DraftNameBackend {
  /** The names for these branches, keyed by branch. Missing ones are absent. */
  forBranches(
    giteaRepoId: number,
    branches: readonly string[],
  ): Promise<Map<string, DraftNameRecord>>;
  set(params: {
    giteaRepoId: number;
    branch: string;
    name: string;
    /** False for the date a draft takes when nobody named it. */
    authored: boolean;
    owner: string;
    now?: number;
  }): Promise<void>;
  /** Forget a draft's name — it has been discarded or proposed. */
  forget(giteaRepoId: number, branch: string): Promise<void>;
}

export class DraftNameStore implements DraftNameBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async forBranches(
    giteaRepoId: number,
    branches: readonly string[],
  ): Promise<Map<string, DraftNameRecord>> {
    if (branches.length === 0) return new Map();

    const rows = this.db
      .select()
      .from(binderDrafts)
      .where(
        and(
          eq(binderDrafts.giteaRepoId, giteaRepoId),
          inArray(binderDrafts.branch, [...branches]),
        ),
      )
      .all();

    return new Map(
      rows.map((row) => [
        row.branch,
        {
          branch: row.branch,
          name: row.name,
          authored: row.authored,
          owner: row.owner,
          updatedAt: row.updatedAt,
        },
      ]),
    );
  }

  async set(params: {
    giteaRepoId: number;
    branch: string;
    name: string;
    authored: boolean;
    owner: string;
    now?: number;
  }): Promise<void> {
    const { giteaRepoId, branch, name, authored, owner } = params;
    const now = params.now ?? Math.floor(Date.now() / 1000);

    this.db
      .insert(binderDrafts)
      .values({ giteaRepoId, branch, name, authored, owner, updatedAt: now })
      .onConflictDoUpdate({
        target: [binderDrafts.giteaRepoId, binderDrafts.branch],
        set: { name, authored, owner, updatedAt: now },
      })
      .run();
  }

  async forget(giteaRepoId: number, branch: string): Promise<void> {
    this.db
      .delete(binderDrafts)
      .where(
        and(
          eq(binderDrafts.giteaRepoId, giteaRepoId),
          eq(binderDrafts.branch, branch),
        ),
      )
      .run();
  }
}

/**
 * Opened on first use, the way the settings store is.
 *
 * The module is imported by the route table at startup and the database file
 * may not exist yet in a test that never touches a draft.
 */
class LazyDraftNameStore implements DraftNameBackend {
  private _store: DraftNameBackend | null = null;

  private get store(): DraftNameBackend {
    if (!this._store) this._store = new DraftNameStore();
    return this._store;
  }

  forBranches(
    giteaRepoId: number,
    branches: readonly string[],
  ): Promise<Map<string, DraftNameRecord>> {
    return this.store.forBranches(giteaRepoId, branches);
  }

  set(params: Parameters<DraftNameBackend["set"]>[0]): Promise<void> {
    return this.store.set(params);
  }

  forget(giteaRepoId: number, branch: string): Promise<void> {
    return this.store.forget(giteaRepoId, branch);
  }
}

export const draftNameStore: DraftNameBackend = new LazyDraftNameStore();

/** `Draft of 19 September` — how a draft names itself by its date. */
function describeByDate(when: Date): string {
  return `Draft of ${when.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  })}`;
}

/**
 * What a draft is called when its author did not say.
 *
 * **Pressing Edit does not ask for a name**, and should not: the overwhelming
 * case is one draft, and a name is worth typing when there is something to
 * tell apart. So a draft started that way gets the date it was started, which
 * is what somebody would call it anyway, and the picker offers Rename the
 * moment the name starts mattering. Starting a *second* draft does ask, and
 * that is where the name earns itself.
 *
 * Fixed at creation, not derived at read time, so it cannot drift.
 */
export function defaultDraftName(now: Date = new Date()): string {
  return describeByDate(now);
}

/**
 * What to call a draft with no row of its own.
 *
 * Every draft made from here on is named at creation, so this is for the ones
 * that already existed when names arrived — and for a row lost to a database
 * restored from a point before it. The date it was last worked on is the only
 * honest thing left to say, and is also how somebody would recognise it.
 */
export function describeUnnamedDraft(updatedAt: string | null): string {
  if (!updatedAt) return "Untitled draft";
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return "Untitled draft";
  return describeByDate(when);
}
