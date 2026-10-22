/**
 * Publishing, as a job that can be stopped anywhere and run again.
 *
 * The handler validates the change and works out everything the publish will
 * write — which documents, at which versions, what is archived and in which
 * sequence, who published — and records that as the plan before the first
 * Gitea write. This runs the plan. Every step asks Gitea first and acts only
 * if it has not happened yet, so running it twice, or resuming it after a
 * crash between the merge and the tags, finishes the publish rather than
 * repeating or refusing it.
 *
 * **Forward, never back.** A merge and a tag are evidence. A half-published
 * change is finished, not undone; one that cannot be finished stops in
 * `failed` with the reason, for a person.
 */

import type { GiteaClient } from "../gitea-client/client";
import type { ArchivedDocument, PublishedPolicy } from "../version-stamp";
import { GiteaApiError, unwrap } from "../gitea-client/client";
import {
  buildDocumentArchivedTag,
  buildDocumentVersionTag,
} from "../../../packages/utils/documentPath";

export interface PublishPlanDocument {
  uid: string;
  slugPath: string;
  path: string;
  /** The title as the product shows it, for the stamp. */
  title: string;
  version: number;
}

export interface PublishPlanArchived {
  uid: string;
  slugPath: string;
  path: string;
  title: string;
  sequence: number;
  lastVersion: number | null;
}

export interface PublishPlan {
  org: string;
  repo: string;
  pullNumber: number;
  mergeStyle: "merge" | "squash" | "rebase";
  /**
   * The branch head approved and planned against. A change merged at any
   * other head is not the change this plan describes, and is not tagged.
   */
  headSha: string;
  /** The branch, so a published draft can be cleaned up afterwards. */
  branch: string;
  documents: PublishPlanDocument[];
  archived: PublishPlanArchived[];
  /** `Alice Example (alice)` — signed onto every stamp. */
  publishedBy: string;
  /** The login, for the archive stamp. */
  publisherLogin: string;
  blockOnUnresolvedThreads: boolean;
}

export interface PublishResult {
  tags: Array<{
    tag: string;
    version: number;
    commitSha: string;
    publishedAt: string;
  }>;
  archived: Array<{ tag: string; commitSha: string }>;
  mergeCommitSha: string;
}

/** What the run needs from the server, passed in so this has no server import. */
export interface PublishDeps {
  merge(params: {
    client: GiteaClient;
    owner: string;
    repo: string;
    pullNumber: number;
    mergeStyle: PublishPlan["mergeStyle"];
  }): Promise<void>;
  /**
   * The approval policy in force, read after the merge: the approvals that
   * count are the ones that stood when Gitea accepted it.
   */
  stampedPolicy(
    client: GiteaClient,
    plan: PublishPlan,
  ): Promise<{
    requiredApprovals: number | null;
    approvedBy: string[];
    signOffEnforced: boolean;
  }>;
  versionStamp(policy: PublishedPolicy): string;
  archiveStamp(archived: ArchivedDocument): string;
  /**
   * Every tag in the binder, by name, with the commit it points at. Read as a
   * list rather than one tag at a time: a document's tags are named
   * `<uid>/v4`, and a slash in a path parameter is a question about Gitea's
   * router this should not depend on.
   */
  readTagCommits(params: {
    client: GiteaClient;
    owner: string;
    repo: string;
  }): Promise<Map<string, string>>;
  discardDraftIfAny(client: GiteaClient, plan: PublishPlan): Promise<void>;
}

/** A conflict that waiting will not resolve. The job stops for a person. */
export class PublishConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishConflict";
  }
}

interface PullState {
  merged?: boolean;
  state?: string;
  merge_commit_sha?: string | null;
  head?: { sha?: string };
}

async function readPull(client: GiteaClient, plan: PublishPlan) {
  return (await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls/{index}", {
      params: {
        path: { owner: plan.org, repo: plan.repo, index: plan.pullNumber },
      },
    }),
  )) as PullState;
}

/** Write one tag unless it is already there, on this merge. */
async function ensureTag(params: {
  client: GiteaClient;
  plan: PublishPlan;
  deps: PublishDeps;
  existing: Map<string, string>;
  tag: string;
  target: string;
  message: string;
}): Promise<{ commitSha: string; publishedAt: string }> {
  const { client, plan, deps, existing, tag, target, message } = params;
  const conflict = (sha: string) =>
    new PublishConflict(
      `${tag} already exists on another commit (${sha.slice(0, 10)}), so change #${plan.pullNumber} cannot be given that version. Nothing was overwritten.`,
    );

  const already = existing.get(tag);
  if (already !== undefined) {
    if (already === target) return { commitSha: already, publishedAt: "" };
    throw conflict(already);
  }

  try {
    const created = (await unwrap(
      client.POST("/repos/{owner}/{repo}/tags", {
        params: { path: { owner: plan.org, repo: plan.repo } },
        body: { tag_name: tag, target, message },
      }),
    )) as { commit?: { sha?: string; created?: string } };
    return {
      commitSha: created?.commit?.sha ?? target,
      publishedAt: created?.commit?.created ?? "",
    };
  } catch (err) {
    // Written by a run that died before it heard back, or by another process:
    // look again rather than report a conflict with ourselves.
    if (err instanceof GiteaApiError && err.status === 409) {
      const now = (
        await deps.readTagCommits({ client, owner: plan.org, repo: plan.repo })
      ).get(tag);
      if (now === target) return { commitSha: now, publishedAt: "" };
      if (now !== undefined) throw conflict(now);
    }
    throw err;
  }
}

export async function runPublish(params: {
  client: GiteaClient;
  plan: PublishPlan;
  deps: PublishDeps;
}): Promise<PublishResult> {
  const { client, plan, deps } = params;

  // 1. Merge, unless it already happened.
  let pull = await readPull(client, plan);
  if (!pull.merged) {
    if (pull.state && pull.state !== "open") {
      throw new PublishConflict(
        `Change #${plan.pullNumber} was closed without being published.`,
      );
    }
    if (plan.headSha && pull.head?.sha && pull.head.sha !== plan.headSha) {
      throw new PublishConflict(
        `Change #${plan.pullNumber} changed after it was checked for publishing. Open it again and publish what is there now.`,
      );
    }
    await deps.merge({
      client,
      owner: plan.org,
      repo: plan.repo,
      pullNumber: plan.pullNumber,
      mergeStyle: plan.mergeStyle,
    });
    pull = await readPull(client, plan);
  } else if (plan.headSha && pull.head?.sha && pull.head.sha !== plan.headSha) {
    throw new PublishConflict(
      `Change #${plan.pullNumber} was merged at a different commit than the one planned, so its versions were not written. Somebody has to look at it.`,
    );
  }

  // 2. The commit every tag points at — not `main`, which a later publish moves.
  const mergeCommitSha = pull.merge_commit_sha || null;
  if (!pull.merged || !mergeCommitSha) {
    throw new Error(
      `Change #${plan.pullNumber} was merged, but Gitea did not report its merge commit yet.`,
    );
  }

  // 3. The tags, each written once.
  const policy = await deps.stampedPolicy(client, plan);
  const stamped = {
    ...policy,
    blockOnUnresolvedThreads: plan.blockOnUnresolvedThreads,
    publishedBy: plan.publishedBy,
    changeNumber: plan.pullNumber,
  };

  // What is already written, read once. A first run finds none of these; a
  // resumed one finds whatever it wrote before it stopped.
  const existing = await deps.readTagCommits({
    client,
    owner: plan.org,
    repo: plan.repo,
  });

  const tags: PublishResult["tags"] = [];
  for (const document of plan.documents) {
    const tag = buildDocumentVersionTag(document.uid, document.version);
    const written = await ensureTag({
      client,
      plan,
      deps,
      existing,
      tag,
      target: mergeCommitSha,
      message: deps.versionStamp({
        ...stamped,
        title: document.title,
        slugPath: document.slugPath,
        path: document.path,
        version: document.version,
      }),
    });
    tags.push({ tag, version: document.version, ...written });
  }

  const archived: PublishResult["archived"] = [];
  for (const document of plan.archived) {
    const tag = buildDocumentArchivedTag(document.uid, document.sequence);
    const written = await ensureTag({
      client,
      plan,
      deps,
      existing,
      tag,
      target: mergeCommitSha,
      message: deps.archiveStamp({
        title: document.title,
        slugPath: document.slugPath,
        path: document.path,
        lastVersion: document.lastVersion,
        sequence: document.sequence,
        archivedBy: plan.publisherLogin,
        changeNumber: plan.pullNumber,
      }),
    });
    archived.push({ tag, commitSha: written.commitSha });
  }

  // 4. Tidy up. Best effort: the merge and the tags are the record.
  await deps.discardDraftIfAny(client, plan).catch(() => {});

  return { tags, archived, mergeCommitSha };
}
