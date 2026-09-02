import type {
  ClosedChange,
  HomeOpenDocument,
  PullRequestWithApprovalState,
} from "./api";
import {
  capitalizeFirst,
  describeApprovalProgress,
  formatDocumentName,
  getReviewerDisplayName,
  hasEnoughApprovals,
  parseChangeTitle,
} from "./documentDisplay";

/**
 * Home is a list of change requests, not a list of documents.
 *
 * Everything on it is derived here so the page itself only renders. The
 * derivation is the interesting part: which of a workspace's changes are
 * actually the reader's business, and what one sentence to say about each.
 */

/** Where a row belongs on the page, and which icon and pill it wears. */
export type HomeChangeKind = "needs_review" | "ready_to_publish" | "submission";

export interface HomeChangeRow {
  key: string;
  owner: string;
  repo: string;
  /** The document the change is against — "Vendor Agreement". */
  documentName: string;
  number: number;
  /** What the change is called. */
  title: string;
  kind: HomeChangeKind;
  /** The one meta sentence under the title, after the document name. */
  meta: string;
  pillLabel: string;
  /** The button on the right of a "Waiting on you" row, when there is one. */
  action: "Review" | "Publish" | null;
}

export type HomeDecidedOutcome = "published" | "closed";

export interface HomeDecidedRow {
  key: string;
  owner: string;
  repo: string;
  documentName: string;
  number: number;
  title: string;
  outcome: HomeDecidedOutcome;
  meta: string;
  pillLabel: string;
}

/** A workspace document paired with the closed changes fetched for it. */
export interface ClosedChangesForDocument {
  owner: string;
  repo: string;
  changes: ClosedChange[];
}

const MAX_DECIDED_ROWS = 5;

/** "Aug 19" — the day a decision was made, with no year to read past. */
export function formatDecisionDate(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toTime(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * "2h ago", "yesterday", "on Aug 12".
 *
 * The meta line is a sentence someone reads at a glance, so recent times are
 * relative and anything older than a week gets the date it actually happened.
 */
export function formatWhen(
  timestamp: string,
  now: number = Date.now(),
): string {
  const at = toTime(timestamp);
  if (at === 0) return "at some point";

  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return `on ${formatDecisionDate(timestamp)}`;
}

/** "Priya", "Priya and Tom", "Priya, Tom and 2 others". */
export function formatNameList(names: string[]): string {
  const [first, second, third] = names;
  if (!first) return "";
  if (!second) return first;
  if (!third) return `${first} and ${second}`;
  if (names.length === 3) return `${first}, ${second} and ${third}`;
  return `${first}, ${second} and ${names.length - 2} others`;
}

function isRequestedReviewer(
  change: PullRequestWithApprovalState,
  username: string,
): boolean {
  return change.reviewers.some((reviewer) => reviewer.login === username);
}

/**
 * Whether the reader still owes this change a decision.
 *
 * A stale approval counts as owing one: the version they signed off on is not
 * the version on the table any more.
 */
function isAwaitingReviewFrom(
  change: PullRequestWithApprovalState,
  username: string,
): boolean {
  return change.reviewers.some(
    (reviewer) =>
      reviewer.login === username &&
      (reviewer.status === "awaiting" || reviewer.stale),
  );
}

function awaitingReviewerNames(change: PullRequestWithApprovalState): string[] {
  return change.reviewers
    .filter((reviewer) => reviewer.status === "awaiting" || reviewer.stale)
    .map(getReviewerDisplayName);
}

function nextVersionOf(document: HomeOpenDocument): number {
  return (document.latestTag?.version ?? 0) + 1;
}

function submitterName(change: { user?: { login: string } | null }): string {
  return capitalizeFirst(change.user?.login ?? "someone");
}

function classify(
  document: HomeOpenDocument,
  change: PullRequestWithApprovalState,
  username: string,
): HomeChangeKind | null {
  const isMine = change.user?.login === username;
  const ownsDocument = document.repo.owner.login === username;

  // Every approval is in. Whoever can publish it is the one being waited on —
  // the person who submitted it, or the person who owns the document.
  if (hasEnoughApprovals(change) && !change.isRejected) {
    if (isMine || ownsDocument) return "ready_to_publish";
    return null;
  }

  if (!isMine && isAwaitingReviewFrom(change, username)) return "needs_review";
  if (isMine) return "submission";

  // A change on a document the reader owns, or was asked to review and already
  // answered, still belongs to them — it just is not waiting on them.
  if (ownsDocument || isRequestedReviewer(change, username))
    return "submission";

  return null;
}

function describeOpenChange(
  document: HomeOpenDocument,
  change: PullRequestWithApprovalState,
  kind: HomeChangeKind,
  username: string,
  now: number,
): string {
  const submittedAt = change.created_at ?? change.created;
  const progress = describeApprovalProgress(change);

  if (kind === "ready_to_publish") {
    return `all approvals in · becomes v${nextVersionOf(document)} when you publish`;
  }

  if (kind === "needs_review") {
    const submitted = `${submitterName(change)} submitted ${formatWhen(submittedAt, now)}`;
    return progress ? `${submitted} · ${progress}` : submitted;
  }

  const waiting = awaitingReviewerNames(change).filter(
    (name) => name.toLowerCase() !== username.toLowerCase(),
  );
  const isMine = change.user?.login === username;
  const submitted = isMine
    ? `submitted ${formatWhen(submittedAt, now)}`
    : `${submitterName(change)} submitted ${formatWhen(submittedAt, now)}`;

  return waiting.length > 0
    ? `waiting on ${formatNameList(waiting)} · ${submitted}`
    : submitted;
}

function pillFor(
  change: PullRequestWithApprovalState,
  kind: HomeChangeKind,
): string {
  if (kind === "needs_review") return "Needs your review";
  if (kind === "ready_to_publish") return "Ready to publish";
  return describeApprovalProgress(change) ?? "In review";
}

/**
 * Every open change the reader is part of, newest first, already sentenced.
 *
 * Changes on documents the reader has nothing to do with are dropped — Home
 * is a to-do list, not a workspace feed.
 */
export function buildOpenChangeRows(
  documents: HomeOpenDocument[],
  username: string,
  now: number = Date.now(),
): HomeChangeRow[] {
  // Change numbers are per-document, so they say nothing about order across a
  // workspace. Last movement does.
  const rows: Array<HomeChangeRow & { movedAt: number }> = [];

  for (const document of documents) {
    for (const change of document.pendingPRs) {
      const kind = classify(document, change, username);
      if (!kind) continue;

      rows.push({
        key: `${document.repo.owner.login}/${document.repo.name}#${change.number}`,
        owner: document.repo.owner.login,
        repo: document.repo.name,
        documentName: formatDocumentName(document.repo.name),
        number: change.number,
        title: parseChangeTitle(change.body, change.user?.login ?? ""),
        kind,
        meta: describeOpenChange(document, change, kind, username, now),
        pillLabel: pillFor(change, kind),
        action:
          kind === "needs_review"
            ? "Review"
            : kind === "ready_to_publish"
              ? "Publish"
              : null,
        movedAt: toTime(
          change.updated_at ?? change.created_at ?? change.created,
        ),
      });
    }
  }

  return rows
    .sort((a, b) => b.movedAt - a.movedAt)
    .map(({ movedAt: _movedAt, ...row }) => row);
}

/** The rows for "Waiting on you" — a decision of the reader's is outstanding. */
export function selectWaitingOnYou(rows: HomeChangeRow[]): HomeChangeRow[] {
  return rows.filter(
    (row) => row.kind === "needs_review" || row.kind === "ready_to_publish",
  );
}

/** The rows for "Your submissions" — moving, but not on the reader's desk. */
export function selectSubmissions(rows: HomeChangeRow[]): HomeChangeRow[] {
  return rows.filter((row) => row.kind === "submission");
}

function describeApprovers(change: ClosedChange, username: string): string {
  const approvers = new Set(
    change.reviews
      .filter((review) => review.state === "approved" && !review.dismissed)
      .map((review) => review.author.login),
  );

  if (approvers.size === 0) return "";

  if (approvers.has(username)) {
    const others = approvers.size - 1;
    if (others === 0) return "you approved";
    if (others === 1) return "you and 1 other approved";
    return `you and ${others} others approved`;
  }

  const names = [...approvers].map(capitalizeFirst);
  return `${formatNameList(names)} approved`;
}

function describeDecision(change: ClosedChange, username: string): string {
  if (change.outcome === "published") {
    return describeApprovers(change, username) || "no approvals were recorded";
  }

  const decidedBy = capitalizeFirst(change.decidedBy ?? change.submittedBy);
  return change.outcome === "declined"
    ? `declined by ${decidedBy}`
    : `withdrawn by ${decidedBy}`;
}

function wasPartOf(change: ClosedChange, username: string): boolean {
  if (change.submittedBy === username) return true;
  if (change.decidedBy === username) return true;
  if (change.reviewers.some((reviewer) => reviewer.login === username)) {
    return true;
  }
  return change.reviews.some((review) => review.author.login === username);
}

/**
 * The last few changes that were actually decided, newest decision first.
 *
 * Only the reader's own — a decision on someone else's document they never
 * touched is not their record to look back on. A document they own counts as
 * theirs, which is why ownership is passed in rather than inferred here.
 */
export function buildDecidedChangeRows(
  documents: ClosedChangesForDocument[],
  username: string,
  ownedRepos: ReadonlySet<string> = new Set(),
  limit: number = MAX_DECIDED_ROWS,
): HomeDecidedRow[] {
  const rows: Array<HomeDecidedRow & { decidedAt: number }> = [];

  for (const document of documents) {
    const owned = ownedRepos.has(`${document.owner}/${document.repo}`);

    for (const change of document.changes) {
      if (!owned && !wasPartOf(change, username)) continue;

      const closedOn = formatDecisionDate(
        change.closedAt ?? change.submittedAt,
      );
      rows.push({
        key: `${document.owner}/${document.repo}#${change.number}`,
        owner: document.owner,
        repo: document.repo,
        documentName: formatDocumentName(document.repo),
        number: change.number,
        title: parseChangeTitle(change.body, change.submittedBy),
        outcome: change.outcome === "published" ? "published" : "closed",
        meta: describeDecision(change, username),
        pillLabel:
          change.outcome === "published" && change.publishedVersion !== null
            ? `Published as v${change.publishedVersion} · ${closedOn}`
            : `Closed · ${closedOn}`,
        decidedAt: toTime(change.closedAt ?? change.submittedAt),
      });
    }
  }

  return rows
    .sort((a, b) => b.decidedAt - a.decidedAt)
    .slice(0, limit)
    .map(({ decidedAt: _decidedAt, ...row }) => row);
}

/** The line under the greeting. It counts only what the reader must act on. */
export function describeWaitingCount(count: number): string {
  if (count === 0) return "Nothing is waiting on you.";
  if (count === 1) return "1 change request is waiting on you.";
  return `${count} change requests are waiting on you.`;
}

/** "Good morning" / "Good afternoon" / "Good evening", by the reader's clock. */
export function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The name in the greeting — a first name, never a login slug. */
export function getGreetingName(
  username: string,
  fullName: string = "",
): string {
  const source = fullName.trim() || username;
  const first = source.split(/[\s\-_]+/).filter(Boolean)[0] ?? "";
  return capitalizeFirst(first);
}
