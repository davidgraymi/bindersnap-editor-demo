/**
 * The activity dataset: what happened on this deployment, one row per event,
 * for the site admin's growth reports and the export.
 *
 * Every row is read from somewhere that already holds it. Accounts are
 * Gitea's; changes, reviews and versions are the binders' pull requests,
 * reviews and tags; organizations, invitations, confirmations and where a
 * signup came from are the API's own tables. A pass reads all of it and
 * replaces the table (`activity_events`), so the table is a derived index in
 * ADR 0004's sense: rebuildable from scratch, never written by a request
 * handler as its primary action, and read by nothing that proves anything.
 * The publish gate, approval checks and the audit export all ask Gitea.
 *
 * **Ids, never names.** A row carries Gitea's numeric ids for the
 * organization, binder and person, and a `detail` that is never personal: the
 * page of bindersnap.com a signup began on, what kind of branch a change came
 * from, a role. The console joins names on at read time; the export does not.
 *
 * **What a pass may keep.** A binder or organization Gitea could not read
 * keeps the rows the last pass wrote for it, so one failing binder leaves its
 * history stale rather than missing. An organization Gitea no longer has
 * (404) loses its rows. A review on a change closed before the last pass
 * began is taken from that pass instead of asked for again; Rebuild now asks
 * for every one.
 */

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  not,
  or,
  type SQL,
} from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { activityBuilds, activityEvents } from "./db/schema";
import { giteaTime } from "./admin-console";
import {
  GiteaApiError,
  readAllPages,
  unwrap,
  type GiteaClient,
} from "./gitea-client/client";
import type { components } from "./gitea-client/spec/gitea";
import { listAllTags, type GitTag } from "./gitea-client/workspaceDocuments";
import { listOrganizationWorkspaces } from "./gitea-client/workspaces";
import type { Invitation } from "./invitations";
import type { OrganizationRecord } from "./organizations";
import type { SignupSourceRow } from "./signup-sources";
import { versionFromTag } from "../../packages/utils/documentPath";

type GiteaUser = components["schemas"]["User"];
type GiteaPull = components["schemas"]["PullRequest"];
type GiteaReview = components["schemas"]["PullReview"];

export const ACTIVITY_KINDS = [
  "account_created",
  "email_confirmed",
  "org_created",
  "invite_sent",
  "invite_accepted",
  "change_proposed",
  "change_published",
  "review_approved",
  "review_changes_requested",
  "version_published",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** Epoch milliseconds. */
  at: number;
  orgId: number | null;
  binderId: number | null;
  changeNumber: number | null;
  actorId: number | null;
  detail: string | null;
}

export interface ActivityBuildError {
  org: string;
  /** Null when the organization's binders could not be listed at all. */
  binder: string | null;
  error: string;
}

export interface ActivityBuild {
  startedAt: number;
  finishedAt: number;
  events: number;
  binders: number;
  errors: ActivityBuildError[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Accounts, organizations, invitations ───────────────────────────────

export interface ActivityAccount {
  id: number;
  login: string;
  createdAt: number | null;
  isSiteAdmin: boolean;
}

/**
 * The events the API's own tables and Gitea's account list hold. Site
 * admins' accounts are not signups, so they have no `account_created`; what
 * they do in an organization still counts.
 */
export function accountEvents(params: {
  accounts: readonly ActivityAccount[];
  signups: readonly SignupSourceRow[];
  confirmations: readonly { username: string; verifiedAt: number }[];
  organizations: readonly OrganizationRecord[];
  invitations: readonly Invitation[];
}): ActivityEvent[] {
  const idOf = new Map(
    params.accounts.map((account) => [
      account.login.trim().toLowerCase(),
      account.id,
    ]),
  );
  const actor = (username: string | null) =>
    username ? (idOf.get(username.trim().toLowerCase()) ?? null) : null;
  const signupOf = new Map(
    params.signups.map((signup) => [signup.username, signup]),
  );
  const base = { binderId: null, changeNumber: null };
  const events: ActivityEvent[] = [];

  for (const account of params.accounts) {
    if (account.isSiteAdmin || account.createdAt === null) continue;
    const signup = signupOf.get(account.login.trim().toLowerCase());
    events.push({
      ...base,
      id: `account_created:${account.id}`,
      kind: "account_created",
      at: account.createdAt,
      orgId: null,
      actorId: account.id,
      detail: signup?.invited ? "invitation" : (signup?.entryPath ?? null),
    });
  }

  for (const confirmation of params.confirmations) {
    const id = actor(confirmation.username);
    if (id === null) continue;
    events.push({
      ...base,
      id: `email_confirmed:${id}`,
      kind: "email_confirmed",
      at: confirmation.verifiedAt,
      orgId: null,
      actorId: id,
      detail: null,
    });
  }

  for (const org of params.organizations) {
    events.push({
      ...base,
      id: `org_created:${org.giteaOrgId}`,
      kind: "org_created",
      // Unix seconds in `organizations`, like the trial column.
      at: org.createdAt * 1000,
      orgId: org.giteaOrgId,
      actorId: actor(org.createdBy),
      detail: org.trialEndsAt === null ? null : "trial",
    });
  }

  for (const invitation of params.invitations) {
    const role = invitation.binderLevel ?? invitation.orgRole;
    events.push({
      ...base,
      id: `invite_sent:${invitation.id}`,
      kind: "invite_sent",
      at: invitation.createdAt,
      orgId: invitation.giteaOrgId,
      actorId: actor(invitation.invitedBy),
      detail: role,
    });
    if (invitation.acceptedAt !== null) {
      events.push({
        ...base,
        id: `invite_accepted:${invitation.id}`,
        kind: "invite_accepted",
        at: invitation.acceptedAt,
        orgId: invitation.giteaOrgId,
        actorId: actor(invitation.acceptedBy),
        detail: role,
      });
    }
  }

  return events;
}

// ─── Binders ────────────────────────────────────────────────────────────

const BRANCH_KINDS = ["draft", "upload", "sign-off", "shape", "retired"];

/**
 * What a change came from, by its branch: a draft from the editor, an upload,
 * a sign-off rule, the binder's shape, a deleted account's draft (`retired`),
 * or `other`.
 */
export function branchKind(ref: string): string {
  const prefix = ref.split("/")[0] ?? "";
  return BRANCH_KINDS.includes(prefix) ? prefix : "other";
}

/** A binder's changes and versions, from its pull requests and tags. */
export function binderEvents(params: {
  orgId: number;
  binderId: number;
  pulls: readonly GiteaPull[];
  tags: readonly GitTag[];
}): ActivityEvent[] {
  const { orgId, binderId } = params;
  const events: ActivityEvent[] = [];
  const changeOfCommit = new Map<string, number>();

  for (const pull of params.pulls) {
    if (typeof pull.number !== "number") continue;
    // Once a published change's branch is deleted, Gitea answers its head as
    // `refs/pull/4/head`; the label keeps the branch's name.
    const detail = branchKind(pull.head?.label || pull.head?.ref || "");
    const proposedAt = giteaTime(pull.created_at);
    if (proposedAt !== null) {
      events.push({
        id: `change_proposed:${binderId}:${pull.number}`,
        kind: "change_proposed",
        at: proposedAt,
        orgId,
        binderId,
        changeNumber: pull.number,
        actorId: pull.user?.id ?? null,
        detail,
      });
    }
    const mergedAt = pull.merged ? giteaTime(pull.merged_at) : null;
    if (mergedAt !== null) {
      events.push({
        id: `change_published:${binderId}:${pull.number}`,
        kind: "change_published",
        at: mergedAt,
        orgId,
        binderId,
        changeNumber: pull.number,
        actorId: pull.merged_by?.id ?? null,
        detail,
      });
      if (pull.merge_commit_sha) {
        changeOfCommit.set(pull.merge_commit_sha, pull.number);
      }
    }
  }

  for (const tag of params.tags) {
    const name = tag.name ?? "";
    const version = versionFromTag(name);
    const at = giteaTime(tag.commit?.created);
    if (version === null || at === null) continue;
    events.push({
      id: `version_published:${binderId}:${name}`,
      kind: "version_published",
      at,
      orgId,
      binderId,
      changeNumber: changeOfCommit.get(tag.commit?.sha ?? "") ?? null,
      actorId: null,
      detail: version === 1 ? "first" : null,
    });
  }

  return events;
}

/** A change's approvals and requests for changes. Comments are not reviews. */
export function reviewEvents(params: {
  orgId: number;
  binderId: number;
  changeNumber: number;
  reviews: readonly GiteaReview[];
}): ActivityEvent[] {
  return params.reviews.flatMap((review): ActivityEvent[] => {
    const kind =
      review.state === "APPROVED"
        ? "review_approved"
        : review.state === "REQUEST_CHANGES"
          ? "review_changes_requested"
          : null;
    const at = giteaTime(review.submitted_at);
    if (!kind || at === null || typeof review.id !== "number") return [];
    return [
      {
        id: `${kind}:${params.binderId}:${review.id}`,
        kind,
        at,
        orgId: params.orgId,
        binderId: params.binderId,
        changeNumber: params.changeNumber,
        actorId: review.user?.id ?? null,
        detail: null,
      },
    ];
  });
}

/** `items` through `work`, at most `limit` at a time, in order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

// ─── A pass ─────────────────────────────────────────────────────────────

export interface ActivityPass {
  build: ActivityBuild;
  events: ActivityEvent[];
  /** Whose rows from the last pass stay, because Gitea could not be read. */
  keep: { binderIds: number[]; orgIds: number[] };
}

export interface ActivityPassDeps {
  client: GiteaClient;
  organizations: readonly OrganizationRecord[];
  signups: readonly SignupSourceRow[];
  confirmations: readonly { username: string; verifiedAt: number }[];
  invitations: readonly Invitation[];
  /**
   * The last pass's reviews, for changes closed before it began: a closed
   * change's reviews do not move. Null asks Gitea for every change's.
   */
  reuse: {
    before: number;
    reviews(binderId: number, changeNumber: number): ActivityEvent[];
  } | null;
  now?: () => number;
}

/** Reviews read at once within a binder. Gitea's request gate still applies. */
const REVIEW_READS = 4;

/**
 * Read everything the dataset holds. Throws only when the account list cannot
 * be read, since every other row names people by the ids it gives; the
 * caller then leaves the table as it was.
 */
export async function collectActivity(
  deps: ActivityPassDeps,
): Promise<ActivityPass> {
  const now = deps.now ?? Date.now;
  const { client } = deps;
  const startedAt = now();

  const users = await readAllPages<GiteaUser>((query) =>
    unwrap(client.GET("/admin/users", { params: { query } })),
  );
  const events = accountEvents({
    accounts: users.flatMap((user) =>
      typeof user.id === "number" && user.login
        ? [
            {
              id: user.id,
              login: user.login,
              createdAt: giteaTime(user.created),
              isSiteAdmin: user.is_admin === true,
            },
          ]
        : [],
    ),
    signups: deps.signups,
    confirmations: deps.confirmations,
    organizations: deps.organizations,
    invitations: deps.invitations,
  });

  const errors: ActivityBuildError[] = [];
  const keep: ActivityPass["keep"] = { binderIds: [], orgIds: [] };
  let binderCount = 0;

  for (const org of deps.organizations) {
    let binders;
    try {
      binders = await listOrganizationWorkspaces({ client, org: org.name });
    } catch (err) {
      // Gone from Gitea: its rows go too. Anything else keeps them.
      if (err instanceof GiteaApiError && err.status === 404) continue;
      errors.push({ org: org.name, binder: null, error: errorText(err) });
      keep.orgIds.push(org.giteaOrgId);
      continue;
    }

    for (const binder of binders) {
      binderCount += 1;
      try {
        const [pulls, tags] = await Promise.all([
          readAllPages<GiteaPull>(
            (query) =>
              unwrap(
                client.GET("/repos/{owner}/{repo}/pulls", {
                  params: {
                    path: { owner: org.name, repo: binder.name },
                    query: { state: "all", ...query },
                  },
                }),
              ),
            { parallel: 3 },
          ),
          listAllTags({ client, owner: org.name, repo: binder.name }),
        ]);
        const scope = { orgId: org.giteaOrgId, binderId: binder.id };
        events.push(...binderEvents({ ...scope, pulls, tags }));

        const reviews = await mapLimit(pulls, REVIEW_READS, async (pull) => {
          const changeNumber = pull.number;
          if (typeof changeNumber !== "number") return [];
          const closedAt = giteaTime(pull.closed_at);
          if (
            deps.reuse &&
            pull.state === "closed" &&
            closedAt !== null &&
            closedAt < deps.reuse.before
          ) {
            return deps.reuse.reviews(binder.id, changeNumber);
          }
          const read = await readAllPages<GiteaReview>((query) =>
            unwrap(
              client.GET("/repos/{owner}/{repo}/pulls/{index}/reviews", {
                params: {
                  path: {
                    owner: org.name,
                    repo: binder.name,
                    index: changeNumber,
                  },
                  query,
                },
              }),
            ),
          );
          return reviewEvents({ ...scope, changeNumber, reviews: read });
        });
        events.push(...reviews.flat());
      } catch (err) {
        errors.push({
          org: org.name,
          binder: binder.name,
          error: errorText(err),
        });
        keep.binderIds.push(binder.id);
      }
    }
  }

  return {
    build: {
      startedAt,
      finishedAt: now(),
      events: events.length,
      binders: binderCount,
      errors,
    },
    events,
    keep,
  };
}

// ─── The table ──────────────────────────────────────────────────────────

/** Rows per insert: well under SQLite's limit on bound values. */
const INSERT_CHUNK = 500;

function toEvent(row: typeof activityEvents.$inferSelect): ActivityEvent {
  return { ...row, kind: row.kind as ActivityKind };
}

export class ActivityStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /**
   * Swap in a pass's rows, in one transaction: every row goes except those
   * the pass could not read again, and its events go in.
   */
  replace(pass: ActivityPass): void {
    const kept: SQL[] = [];
    if (pass.keep.binderIds.length > 0) {
      kept.push(inArray(activityEvents.binderId, pass.keep.binderIds));
    }
    if (pass.keep.orgIds.length > 0) {
      kept.push(
        and(
          inArray(activityEvents.orgId, pass.keep.orgIds),
          isNotNull(activityEvents.binderId),
        )!,
      );
    }

    this.db.transaction((tx) => {
      if (kept.length === 0) tx.delete(activityEvents).run();
      else
        tx.delete(activityEvents)
          .where(not(or(...kept)!))
          .run();

      for (let i = 0; i < pass.events.length; i += INSERT_CHUNK) {
        tx.insert(activityEvents)
          .values(pass.events.slice(i, i + INSERT_CHUNK))
          .onConflictDoNothing()
          .run();
      }

      const build = {
        ...pass.build,
        errors: JSON.stringify(pass.build.errors),
      };
      tx.insert(activityBuilds)
        .values({ id: 1, ...build })
        .onConflictDoUpdate({ target: activityBuilds.id, set: build })
        .run();
    });
  }

  /** Every event, oldest first. */
  list(): ActivityEvent[] {
    return this.db
      .select()
      .from(activityEvents)
      .orderBy(asc(activityEvents.at), asc(activityEvents.id))
      .all()
      .map(toEvent);
  }

  /** One change's reviews, as the last pass wrote them. */
  reviewsFor(binderId: number, changeNumber: number): ActivityEvent[] {
    return this.db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.binderId, binderId),
          eq(activityEvents.changeNumber, changeNumber),
          inArray(activityEvents.kind, [
            "review_approved",
            "review_changes_requested",
          ]),
        ),
      )
      .all()
      .map(toEvent);
  }

  lastBuild(): ActivityBuild | null {
    const row = this.db
      .select()
      .from(activityBuilds)
      .where(eq(activityBuilds.id, 1))
      .get();
    if (!row) return null;
    let errors: ActivityBuildError[] = [];
    try {
      errors = JSON.parse(row.errors) as ActivityBuildError[];
    } catch {
      // A row this code did not write: report it as a pass without errors.
    }
    return {
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      events: row.events,
      binders: row.binders,
      errors,
    };
  }
}

let store: ActivityStore | null = null;

export function activityStore(): ActivityStore {
  store ??= new ActivityStore();
  return store;
}
