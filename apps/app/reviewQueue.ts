/**
 * Every change in flight, across every binder, in one list.
 *
 * Home answers "what is waiting on me" and answers it well, but it is a to-do
 * list: it drops the changes that are moving without the reader, it cannot be
 * sorted or filtered, and it shows a fixed handful. Until this page existed the
 * only way to see a change was to remember which binder it was in and open
 * that binder's own tab, which is a question nobody arrives with.
 *
 * The queue is the other half. Same data, no dropping, and **every change in
 * exactly one section** — the state it is in, read in the order somebody
 * acts: what is waiting on your review, what was sent back, what can be
 * published, and what is waiting on somebody else. "Waiting on you" used to
 * cut across the others, so a change ready to publish was in two places and
 * the counts did not add up to the whole.
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
import type { ChangeStandingTone } from "./changeRow";
import { describeChangeMeta, describeChangeStandingWord } from "./changeRow";

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
  /**
   * "#4 · Alice opened 2 hours ago" — the line under the title.
   *
   * The document it touches is not on it: a change can touch three, and
   * naming one of them is a claim about the other two.
   */
  meta: string;
  status: QueueStatus;
  /** The one section of the page it is listed in. */
  section: QueueSection;
  /** Where it stands, in one word. */
  standing: string;
  tone: ChangeStandingTone;
  /**
   * How many comments are on it — the count Home and a binder's own list put
   * beside the same change. A row that showed it in two lists and not the
   * third read as a change nobody had discussed.
   */
  commentCount: number;
  /** Sort key. Not rendered. */
  movedAt: number;
}

/**
 * The sections of the page, top to bottom. Exclusive: a change is in the
 * first one whose rule it meets, and in no other.
 */
export const QUEUE_SECTIONS = [
  "your_review",
  "changes_requested",
  "ready",
  "in_review",
] as const;
export type QueueSection = (typeof QUEUE_SECTIONS)[number];

export const QUEUE_SECTION_LABELS: Record<QueueSection, string> = {
  your_review: "Waiting on your review",
  changes_requested: "Changes requested",
  ready: "Ready to publish",
  in_review: "In review",
};

/** What an empty section says — that it is empty, and why that is fine. */
export const QUEUE_SECTION_EMPTY: Record<QueueSection, string> = {
  your_review: "Nobody is waiting on your review.",
  changes_requested: "No change has been sent back.",
  ready: "Nothing is ready to publish.",
  in_review: "Nothing is waiting on anybody else.",
};

function toTime(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Has this reader been asked to review it, and not yet answered?
 *
 * Asked and not answered is your turn whatever else is true of the change: a
 * binder that needs no approvals reads "ready" with a request still open, and
 * a change somebody else sent back is still waiting on what you think.
 */
function isAwaitingReader(
  change: HomeOpenDocument["pendingPRs"][number],
  username: string,
): boolean {
  const login = username.toLowerCase();
  return change.reviewers.some(
    (reviewer) =>
      reviewer.login.toLowerCase() === login && reviewer.status === "awaiting",
  );
}

/** The one section a change is listed in. */
export function queueSection(
  status: QueueStatus,
  awaitingReader: boolean,
): QueueSection {
  if (awaitingReader) return "your_review";
  if (status === "blocked") return "changes_requested";
  if (status === "ready") return "ready";
  return "in_review";
}

function statusFromStanding(standing: ChangeStanding | null): QueueStatus {
  if (!standing) return "in_review";
  if (standing.tone === "blocked") return "blocked";
  if (standing.tone === "ready") return "ready";
  return "in_review";
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
        isApproved: change.isApproved,
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
        meta: describeChangeMeta(
          {
            number: change.number,
            submittedBy: change.user?.login ?? "",
            // Your own change says "You", as "you approved" does: your name
            // on every row of your own work is noise.
            submittedByName:
              change.user?.login === username ? "You" : change.user?.full_name,
            submittedAt: change.created_at ?? change.created ?? "",
            updatedAt: change.updated_at ?? undefined,
            approvalCount: change.approvalCount,
            requiredApprovals: change.requiredApprovals,
          },
          now,
        ),
        status,
        section: queueSection(status, isAwaitingReader(change, username)),
        ...describeChangeStandingWord({
          number: change.number,
          submittedBy: change.user?.login ?? "",
          submittedAt: change.created_at ?? change.created ?? "",
          approvalCount: change.approvalCount,
          requiredApprovals: change.requiredApprovals,
          isRejected: standing?.tone === "blocked",
          isApproved: change.isApproved,
        }),
        // Gitea's own count on the pull request, passed through as Home reads it.
        commentCount: (change as { comments?: number }).comments ?? 0,
        movedAt,
      });
    }
  }

  return rows.sort((a, b) => b.movedAt - a.movedAt);
}

/** The rows of each section, in the order the page lists them. */
export function groupQueueRows(
  rows: QueueRow[],
): Record<QueueSection, QueueRow[]> {
  const groups = Object.fromEntries(
    QUEUE_SECTIONS.map((section) => [section, [] as QueueRow[]]),
  ) as Record<QueueSection, QueueRow[]>;
  for (const row of rows) groups[row.section].push(row);
  return groups;
}

/** The sentence under the page title. */
export function describeQueue(
  groups: Record<QueueSection, QueueRow[]>,
): string {
  const total = QUEUE_SECTIONS.reduce(
    (sum, section) => sum + groups[section].length,
    0,
  );
  if (total === 0) return "Nothing is in flight right now.";

  const changes = total === 1 ? "1 change" : `${total} changes`;
  const yours = groups.your_review.length;
  if (yours === 0) {
    return `${changes} in flight. None of them is waiting on your review.`;
  }
  return `${changes} in flight · ${yours} waiting on your review.`;
}
