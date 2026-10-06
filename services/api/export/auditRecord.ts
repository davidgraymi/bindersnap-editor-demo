import { createHash } from "node:crypto";

import {
  documentUidFromVersionTag,
  versionFromTag,
} from "../../../packages/utils/documentPath";
import { listDiscussions } from "../gitea-client/discussions";
import { getPullRequestWithReviews } from "../gitea-client/pullRequests";
import { unwrap, type GiteaClient } from "../gitea-client/client";
import type { components } from "../gitea-client/spec/gitea";
import { readStampedChange } from "../version-stamp";

/**
 * Everything the audit packet says, read from Gitea and nowhere else.
 *
 * **No fact here is computed and stored by us.** A version is a tag; who
 * approved it is the pull request's reviews; what was discussed is its
 * comments; the fingerprint of the file is git's own blob hash. #368 is
 * explicit that the packet must trace every line to a Gitea primitive, and
 * the reason is the product's claim: a packet built from a table we could
 * edit would prove nothing.
 */

type Tag = components["schemas"]["Tag"];
type PullReview = components["schemas"]["PullReview"];

export interface AuditPerson {
  login: string;
  name: string;
}

export interface AuditReview {
  reviewer: AuditPerson;
  /** `approved`, `changes_requested` or `commented`. */
  decision: string;
  at: string;
  /** The commit the reviewer was looking at when they decided. */
  commit: string;
  /** Superseded by a later push, so it no longer counted. */
  stale: boolean;
  dismissed: boolean;
  comment: string;
}

export interface AuditThread {
  id: string;
  comments: { author: AuditPerson; at: string; body: string }[];
  /** Every resolve and reopen, in order — reopened concerns stay visible. */
  events: { actor: AuditPerson; resolved: boolean; at: string }[];
  resolved: boolean;
}

export interface AuditVersion {
  version: number;
  tag: string;
  /** The annotated tag object's own hash. */
  tagObject: string;
  /** The approval policy stamped on the tag when it was published. */
  tagMessage: string;
  commit: string;
  publishedAt: string;
  /** The file this version is, identity segment included. */
  path: string;
  /** Git's blob hash of the file's exact bytes. */
  blob: string;
  /** SHA-256 of the same bytes, for anybody without git to hand. */
  sha256: string;
  size: number;
  change: {
    number: number;
    title: string;
    description: string;
    author: AuditPerson;
    openedAt: string;
    publishedBy: AuditPerson | null;
    publishedAt: string | null;
  } | null;
  reviews: AuditReview[];
  threads: AuditThread[];
}

export interface AuditRecord {
  organization: string;
  binder: string;
  document: { title: string; slugPath: string; uid: string };
  exportedAt: string;
  exportedBy: string;
  versions: AuditVersion[];
}

export interface AuditRecordWithFiles {
  record: AuditRecord;
  /** Each version's exact bytes, by version number. */
  files: Map<number, Uint8Array>;
}

/** Git's hash for a file: SHA-1 over `blob <length>\0` and the bytes. */
export function gitBlobHash(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function person(
  user: { login?: string; full_name?: string } | null | undefined,
): AuditPerson {
  return {
    login: user?.login ?? "unknown",
    name: user?.full_name?.trim() || user?.login || "unknown",
  };
}

function decisionOf(state: string | undefined): string | null {
  switch ((state ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REQUEST_CHANGES":
      return "changes_requested";
    case "COMMENT":
      return "commented";
    default:
      return null;
  }
}

function toReview(review: PullReview): AuditReview | null {
  const decision = decisionOf(review.state);
  if (!decision) return null;
  return {
    reviewer: person(review.user),
    decision,
    at: review.submitted_at ?? review.updated_at ?? "",
    commit: review.commit_id ?? "",
    stale: review.stale === true,
    dismissed: review.dismissed === true,
    comment: review.body ?? "",
  };
}

/** The file a version is, from the stamp's summary line: `Title v3 — path`. */
export function pathFromStamp(message: string): string | null {
  const first = message.split("\n")[0] ?? "";
  const match = first.match(/ v\d+ — (.+)$/);
  return match ? match[1]!.trim() : null;
}

async function listAllTags(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<Tag[]> {
  const all: Tag[] = [];
  for (let page = 1; page < 200; page += 1) {
    const batch = (await unwrap(
      client.GET("/repos/{owner}/{repo}/tags", {
        params: { path: { owner, repo }, query: { page, limit: 50 } },
      }),
    )) as Tag[];
    all.push(...(batch ?? []));
    if (!batch || batch.length < 50) break;
  }
  return all;
}

export async function gatherAuditRecord(params: {
  client: GiteaClient;
  /** Reads raw bytes as the caller: `(path, ref) => bytes`. */
  readFile: (path: string, ref: string) => Promise<Uint8Array>;
  org: string;
  binder: string;
  document: { title: string; slugPath: string; uid: string; path: string };
  exportedBy: string;
  now?: Date;
}): Promise<AuditRecordWithFiles> {
  const { client, org, binder, document } = params;
  const tags = (await listAllTags(client, org, binder))
    .filter((tag) => documentUidFromVersionTag(tag.name ?? "") === document.uid)
    .map((tag) => ({ tag, version: versionFromTag(tag.name ?? "") }))
    .filter(
      (entry): entry is { tag: Tag; version: number } => entry.version !== null,
    )
    .sort((left, right) => left.version - right.version);

  const files = new Map<number, Uint8Array>();
  const versions: AuditVersion[] = [];

  // One version at a time: a long history is many calls, and running them
  // all at once is a burst Gitea does not need.
  for (const { tag, version } of tags) {
    const name = tag.name ?? "";
    const message = tag.message ?? "";
    const path = pathFromStamp(message) ?? document.path;
    const bytes = await params
      .readFile(path, name)
      .catch(() => new Uint8Array());
    files.set(version, bytes);

    const changeNumber = readStampedChange(message);
    let change: AuditVersion["change"] = null;
    let reviews: AuditReview[] = [];
    let threads: AuditThread[] = [];
    if (changeNumber !== null) {
      const [withReviews, discussions] = await Promise.all([
        getPullRequestWithReviews({
          client,
          owner: org,
          repo: binder,
          pullNumber: changeNumber,
        }).catch(() => null),
        listDiscussions({
          client,
          owner: org,
          repo: binder,
          pullNumber: changeNumber,
        }).catch(() => null),
      ]);
      if (withReviews) {
        const pull = withReviews.pullRequest;
        change = {
          number: changeNumber,
          title: pull.title ?? "",
          description: pull.body ?? "",
          author: person(pull.user),
          openedAt: pull.created_at ?? "",
          publishedBy: pull.merged_by ? person(pull.merged_by) : null,
          publishedAt: pull.merged_at ?? null,
        };
        reviews = withReviews.reviews
          .map(toReview)
          .filter((review): review is AuditReview => review !== null)
          .sort((left, right) => left.at.localeCompare(right.at));
      }
      threads = (discussions?.threads ?? []).map((thread) => ({
        id: thread.id,
        comments: thread.comments.map((comment) => ({
          author: {
            login: comment.author.login,
            name: comment.author.fullName || comment.author.login,
          },
          at: comment.createdAt,
          body: comment.body,
        })),
        events: thread.events.map((event) => ({
          actor: {
            login: event.actor.login,
            name: event.actor.fullName || event.actor.login,
          },
          resolved: event.resolved,
          at: event.at,
        })),
        resolved: thread.resolved,
      }));
    }

    versions.push({
      version,
      tag: name,
      tagObject: tag.id ?? "",
      tagMessage: message,
      commit: tag.commit?.sha ?? "",
      publishedAt: tag.commit?.created ?? "",
      path,
      blob: gitBlobHash(bytes),
      sha256: sha256(bytes),
      size: bytes.byteLength,
      change,
      reviews,
      threads,
    });
  }

  return {
    record: {
      organization: org,
      binder,
      document: {
        title: document.title,
        slugPath: document.slugPath,
        uid: document.uid,
      },
      exportedAt: (params.now ?? new Date()).toISOString(),
      exportedBy: params.exportedBy,
      versions,
    },
    files,
  };
}

/**
 * The approvals that counted for a version: approvals of the commit that was
 * published, neither stale nor dismissed. The same rule Gitea applied at the
 * merge, so the packet cannot name somebody who approved a draft they never
 * saw finished.
 */
export function standingApprovals(version: AuditVersion): AuditReview[] {
  const latestByReviewer = new Map<string, AuditReview>();
  for (const review of version.reviews) {
    if (review.decision === "commented") continue;
    latestByReviewer.set(review.reviewer.login, review);
  }
  return [...latestByReviewer.values()].filter(
    (review) =>
      review.decision === "approved" && !review.stale && !review.dismissed,
  );
}
