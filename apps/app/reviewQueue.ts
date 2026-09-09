/**
 * Every change in flight, across every binder, in one list.
 *
 * Home answers "what is waiting on me" and answers it well, but it is a to-do
 * list: it drops the changes that are moving without the reader, it cannot be
 * sorted or filtered, and it shows a fixed handful. Until this page existed the
 * only way to see a change was to remember which binder it was in and open
 * that binder's own tab, which is a question nobody arrives with.
 *
 * The queue is the other half. Same data, no dropping, four counters that are
 * also filters.
 *
 * **Where the rows come from.** `GET /api/app/home/changes` already returns
 * every open change on every binder the reader is involved in — Home filters
 * that payload down to two sections rather than the server sending a narrower
 * one. So this needs no new endpoint, and cannot disagree with Home about the
 * state of a change, because there is one source.
 *
 * **What that scoping does and does not cover.** "Involved in" is the unit: a
 * binder reaches this list once the reader has a change of their own in it, is
 * a requested reviewer on one, or owns the document. A binder they can see but
 * have never been part of does not appear. That is the right shape for a review
 * queue — this is the work that concerns you, not a feed of the organization —
 * but it is a real limit, and the day the product wants "every change I have
 * permission to see" it needs a server-side search rather than a wider filter
 * here.
 */

import type { HomeOpenDocument } from "./api";
import {
  describeChangeStanding,
  formatDocumentName,
  parseChangeTitle,
  type ChangeStanding,
} from "./documentDisplay";
import { formatWhen } from "./homeChanges";

/**
 * Where a change stands. Mutually exclusive, and between them they cover every
 * open change — which is what lets the counters be read as a breakdown.
 */
export type QueueStatus = "blocked" | "ready" | "in_review";

export interface QueueRow {
  key: string;
  owner: string;
  repo: string;
  number: number;
  /** What the change is called, as its submitter wrote it. */
  title: string;
  /** The binder it is filed in — "Clinical". */
  binderName: string;
  /** The document it changes, or the binder when it changes no document. */
  documentName: string;
  /** Who sent it. */
  requestedBy: string;
  /** "1 of 2 approvals", or null when the binder demands none. */
  progress: string | null;
  status: QueueStatus;
  /** Why it stands there, naming a person where there is one to name. */
  statusReason: string;
  /**
   * A decision of the reader's is outstanding. Cuts across `status` rather
   * than being one of its values: a change can be both blocked and waiting on
   * you, and hiding either fact would be the wrong one to hide.
   */
  waitingOnYou: boolean;
  /** The version it publishes as, when it is ready and the document is known. */
  becomesVersion: number | null;
  /** When it last moved, already worded — "2h ago". */
  movedWhen: string;
  /** Sort key. Not rendered. */
  movedAt: number;
}

/** The filters, in the order they appear across the top of the page. */
export const QUEUE_FILTERS = [
  "waiting",
  "in_review",
  "ready",
  "blocked",
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number] | "all";

export const QUEUE_FILTER_LABELS: Record<QueueFilter, string> = {
  all: "All changes",
  waiting: "Waiting on you",
  in_review: "In review",
  ready: "Ready to publish",
  blocked: "Blocked",
};

function toTime(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Is a decision of this reader's outstanding?
 *
 * Two ways for that to be true, and they are different questions. Either they
 * are a requested reviewer who has not answered — or every approval is in and
 * they are the one who can publish it, which is the submitter or the person
 * who owns the document.
 */
function isWaitingOnReader(
  document: HomeOpenDocument,
  change: HomeOpenDocument["pendingPRs"][number],
  username: string,
  status: QueueStatus,
): boolean {
  const login = username.toLowerCase();

  if (status === "ready") {
    const isMine = change.user?.login?.toLowerCase() === login;
    const ownsDocument = document.repo.owner.login.toLowerCase() === login;
    return isMine || ownsDocument;
  }

  return change.reviewers.some(
    (reviewer) =>
      reviewer.login.toLowerCase() === login && reviewer.status === "awaiting",
  );
}

function statusFromStanding(standing: ChangeStanding | null): QueueStatus {
  if (!standing) return "in_review";
  if (standing.tone === "blocked") return "blocked";
  if (standing.tone === "ready") return "ready";
  return "in_review";
}

/**
 * The document a change is about, or the binder when it is about none.
 *
 * A change to a binder's sign-off rules touches no document, so naming one
 * would be inventing it.
 */
function subjectOf(
  document: HomeOpenDocument,
  change: HomeOpenDocument["pendingPRs"][number],
): string {
  const path = change.documentSlugPath;
  if (!path) return formatDocumentName(document.repo.name);
  const leaf = path.split("/").pop() ?? path;
  return formatDocumentName(leaf.replace(/\.[^.]+$/, ""));
}

/** Every open change the reader is part of, most recently moved first. */
export function buildQueueRows(
  documents: HomeOpenDocument[],
  username: string,
  now: number = Date.now(),
): QueueRow[] {
  const rows: QueueRow[] = [];

  for (const document of documents) {
    for (const change of document.pendingPRs) {
      // One vocabulary for where a change stands, shared with the binder's own
      // change list. "Carol Mendes asked for changes" beats "Blocked".
      const standing = describeChangeStanding({
        open: true,
        approvalCount: change.approvalCount,
        requiredApprovals: change.requiredApprovals,
        reviewers: change.reviewers,
      });
      const status = statusFromStanding(standing);
      const movedAt = toTime(
        change.updated_at ?? change.created_at ?? change.created,
      );

      rows.push({
        key: `${document.repo.owner.login}/${document.repo.name}#${change.number}`,
        owner: document.repo.owner.login,
        repo: document.repo.name,
        number: change.number,
        title: parseChangeTitle(change.body, change.user?.login ?? ""),
        binderName: formatDocumentName(document.repo.name),
        documentName: subjectOf(document, change),
        requestedBy: change.user?.login ?? "Somebody",
        progress: standing?.progress ?? null,
        status,
        // A binder that demands no approvals has no standing to report, and
        // "in review" is the honest thing to say about it.
        statusReason: standing?.reason ?? "In review",
        waitingOnYou: isWaitingOnReader(document, change, username, status),
        becomesVersion: change.nextVersion,
        movedWhen: formatWhen(
          change.updated_at ?? change.created_at ?? change.created,
          now,
        ),
        movedAt,
      });
    }
  }

  return rows.sort((a, b) => b.movedAt - a.movedAt);
}

/** How many rows each filter would show. */
export function countQueueRows(rows: QueueRow[]): Record<QueueFilter, number> {
  return {
    all: rows.length,
    waiting: rows.filter((row) => row.waitingOnYou).length,
    in_review: rows.filter((row) => row.status === "in_review").length,
    ready: rows.filter((row) => row.status === "ready").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
  };
}

export function filterQueueRows(
  rows: QueueRow[],
  filter: QueueFilter,
): QueueRow[] {
  if (filter === "all") return rows;
  if (filter === "waiting") return rows.filter((row) => row.waitingOnYou);
  return rows.filter((row) => row.status === filter);
}

/** The sentence under the page title. */
export function describeQueue(counts: Record<QueueFilter, number>): string {
  if (counts.all === 0) return "Nothing is in flight right now.";

  const changes = counts.all === 1 ? "1 change" : `${counts.all} changes`;
  if (counts.waiting === 0) {
    return `${changes} in flight. None of them is waiting on you.`;
  }
  return `${changes} in flight · ${counts.waiting} waiting on you.`;
}

/** Which filter a page should open on, given what is in the queue. */
export function initialQueueFilter(
  counts: Record<QueueFilter, number>,
): QueueFilter {
  // Land on the reader's own work when there is any — it is why they came —
  // and on everything when there is not, because an empty list under a filter
  // reads as an empty product.
  return counts.waiting > 0 ? "waiting" : "all";
}
