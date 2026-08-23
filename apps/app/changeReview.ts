/**
 * Everything the change review page says, decided here.
 *
 * The page renders a spine of events. What counts as an event, what order they
 * happened in, and the exact sentence each one reads are decisions — and a
 * decision that lives inside JSX can only be checked by looking at a browser.
 * So they live here, and the components below only lay them out.
 */

import type { ChangeUpdate, DiscussionThread, VersionReview } from "./api";
import type { ChangeOutcome, ChangeRecord } from "./documentDisplay";
import { capitalizeFirst, formatShortDate } from "./documentDisplay";

/** "Aug 21", the form every date on this page takes. */
export function formatEventDate(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Aug 20, 9:14 AM" — used where the hour is worth the width. */
export function formatEventMoment(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeOf(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function personName(author: { login: string; fullName: string }): string {
  return author.fullName.trim() || capitalizeFirst(author.login);
}

/**
 * The line under the change's title.
 *
 * One sentence, saying the two things a reader opens a change to learn: who
 * asked for this, and what the document becomes if it goes through.
 */
export function describeChangeOpening(
  change: Pick<ChangeRecord, "submittedBy" | "submittedAt" | "open">,
  nextVersion: number,
): { who: string; when: string; becomes: number | null } {
  return {
    who: capitalizeFirst(change.submittedBy || "Someone"),
    when: formatShortDate(change.submittedAt),
    becomes: change.open ? nextVersion : null,
  };
}

/**
 * The author's own account of the change, when it says something the title
 * has not already said.
 *
 * A change submitted with a one-line description gets that line as its title
 * too, and the redesign put the two of them one under the other — so the page
 * said the same sentence twice before anyone had read a word of the review.
 */
export function describeChangeBody(
  summary: string,
  description: string,
): string | null {
  const body = description.trim();
  if (!body) return null;
  return body === summary.trim() ? null : body;
}

/**
 * The proposed-version card's mono line: which file, which update, when.
 *
 * Fixed chrome in a fixed place on every change, so a reviewer never has to
 * hunt for the thing they are being asked to approve. "update 2 of 2" is the
 * honest answer to "am I looking at the latest one?" — a question the old
 * single "Preview" button left a reader to guess at.
 */
export interface ProposedVersionFacts {
  fileName: string;
  /** "update 2 of 2", or null when there is only ever been one. */
  updateLabel: string | null;
  /** When the newest update landed. Empty when nothing is known. */
  date: string;
  /** The ref to open, newest update first, falling back to the branch. */
  ref: string | null;
  /** Whether there is more than one update, so "All updates" is worth showing. */
  hasHistory: boolean;
}

export function buildProposedVersionFacts(params: {
  fileName: string | null;
  branchName: string | null;
  submittedAt: string;
  updates: ChangeUpdate[];
}): ProposedVersionFacts {
  const { fileName, branchName, submittedAt, updates } = params;
  const latest = updates.length > 0 ? updates[updates.length - 1]! : null;

  return {
    fileName: fileName ?? "The submitted file",
    updateLabel:
      updates.length > 1
        ? `update ${latest!.index} of ${updates.length}`
        : null,
    date: formatEventDate(latest?.at ?? submittedAt),
    // The branch head and the newest update are the same commit, and the
    // branch keeps working when the updates call fails or returns nothing.
    ref: branchName,
    hasHistory: updates.length > 1,
  };
}

/**
 * Where a thread stands, and how much of it to show.
 *
 * A thread is one comment primitive: a reply is what makes it a thread, and
 * the card looks the same either way. What changes is the marker at the top
 * right and how much text is under it.
 */
export interface ThreadFacts {
  resolved: boolean;
  /** Replies after the root. Zero means this is still a lone comment. */
  replyCount: number;
  /** "Show 2 replies" / "Collapse", per the current state. */
  toggleLabel: string;
  /** Whether a toggle is worth rendering: a lone comment has nothing to hide. */
  collapsible: boolean;
  /**
   * "Priya marked this as resolved · Aug 21 · a new comment reopens it".
   * Null while the thread is open — the marker already says so.
   */
  resolutionNote: string | null;
}

export function buildThreadFacts(
  thread: DiscussionThread,
  collapsed: boolean,
): ThreadFacts {
  const replyCount = Math.max(0, thread.comments.length - 1);
  const resolvedEvent = [...thread.events]
    .filter((event) => event.resolved)
    .sort((left, right) => timeOf(left.at) - timeOf(right.at))
    .pop();

  return {
    resolved: thread.resolved,
    replyCount,
    toggleLabel: collapsed
      ? replyCount === 1
        ? "Show 1 reply"
        : `Show ${replyCount} replies`
      : "Collapse",
    collapsible: replyCount > 0,
    resolutionNote:
      thread.resolved && resolvedEvent
        ? `${personName(resolvedEvent.actor)} marked this as resolved · ${formatEventDate(
            resolvedEvent.at,
          )} · a new comment reopens it`
        : null,
  };
}

/** What kind of thing happened, which decides the glyph on the spine. */
export type TimelineEntryKind =
  | "opened"
  | "thread"
  | "update"
  | "approved"
  | "changes"
  | "commented"
  | "closed";

export interface TimelineEntry {
  key: string;
  kind: TimelineEntryKind;
  at: number;
  /** Set for a thread; the component renders the card itself. */
  thread: DiscussionThread | null;
  /** The plain-text row for everything that is not a thread. */
  event: TimelineEvent | null;
}

/**
 * One event on the paper: a name, what they did, when, and sometimes a note.
 *
 * Split into parts rather than one string because the name and the verb are
 * weighted differently — "**Priya** **approved**" is the whole point of the
 * green rows, and a pre-joined sentence could not carry that.
 */
export interface TimelineEvent {
  actor: string | null;
  /** "opened this change request", "approved", "updated the proposed version". */
  verb: string;
  /** Rendered in the green the approval rows own. */
  emphasiseVerb: boolean;
  /** "(update 2)" — set in mono beside the verb. */
  tag: string | null;
  when: string;
  /** "earlier approvals were reset", "Matches what legal sent over." */
  note: string | null;
  /** An update the reader can go and look at. */
  updateSha: string | null;
}

function reviewKind(review: VersionReview): TimelineEntryKind {
  if (review.state === "approved") return "approved";
  if (review.state === "changes_requested") return "changes";
  return "commented";
}

function reviewVerb(review: VersionReview): string {
  if (review.state === "approved") return "approved";
  if (review.state === "changes_requested") return "asked for changes";
  return "commented";
}

/**
 * Review bodies that are not a sentence anybody wrote.
 *
 * Approving used to post the state word as the body, so the record carries
 * approvals whose only text is "APPROVED". Quoted on the timeline that reads
 * as a remark, so it is dropped — the row already says they approved.
 */
const MACHINE_REVIEW_BODIES = new Set([
  "approved",
  "approve",
  "request_changes",
  "changes_requested",
  "comment",
  "commented",
]);

function reviewNote(review: VersionReview): string | null {
  const parts: string[] = [];
  const body = review.body.trim();
  if (body && !MACHINE_REVIEW_BODIES.has(body.toLowerCase())) {
    parts.push(`"${body}"`);
  }
  // A dismissed or superseded approval still happened, and an audit trail that
  // quietly drops it is not an audit trail. It says so instead.
  if (review.dismissed) parts.push("later dismissed");
  else if (review.stale) parts.push("superseded by a later update");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function closingEvent(
  outcome: ChangeOutcome,
  decidedBy: string | null,
  publishedVersion: number | null,
  when: string,
): TimelineEvent {
  if (outcome === "published") {
    return {
      actor: decidedBy ? capitalizeFirst(decidedBy) : null,
      verb:
        publishedVersion === null
          ? "published this"
          : `published this as v${publishedVersion}`,
      emphasiseVerb: true,
      tag: null,
      when,
      note: null,
      updateSha: null,
    };
  }

  return {
    actor: decidedBy ? capitalizeFirst(decidedBy) : null,
    verb:
      outcome === "declined"
        ? "closed this without publishing"
        : "withdrew this change",
    emphasiseVerb: false,
    tag: null,
    when,
    note: null,
    updateSha: null,
  };
}

/**
 * Everything that has happened to this change, in the order it happened.
 *
 * Threads, reviews and proposal updates are three different records in Gitea
 * and one story to a reader. Update 1 is deliberately not an event: it is the
 * change being opened, which the first row already says — numbering it twice
 * would make every change look like it had been corrected once before anyone
 * touched it.
 */
export function buildReviewTimeline(params: {
  change: ChangeRecord;
  threads: DiscussionThread[];
  updates: ChangeUpdate[];
  resetsApprovals: boolean;
}): TimelineEntry[] {
  const { change, threads, updates, resetsApprovals } = params;

  const opened: TimelineEntry = {
    key: "opened",
    kind: "opened",
    at: timeOf(change.submittedAt),
    thread: null,
    event: {
      actor: capitalizeFirst(change.submittedBy || "Someone"),
      verb: "opened this change request",
      emphasiseVerb: false,
      tag: null,
      when: formatEventMoment(change.submittedAt),
      note: null,
      updateSha: null,
    },
  };

  const updateEntries: TimelineEntry[] = updates
    .filter((update) => update.index > 1)
    .map((update) => ({
      key: `update-${update.sha}`,
      kind: "update" as const,
      at: timeOf(update.at),
      thread: null,
      event: {
        actor: capitalizeFirst(update.author || "Someone"),
        verb: "updated the proposed version",
        emphasiseVerb: false,
        tag: `(update ${update.index})`,
        when: formatEventDate(update.at),
        note: resetsApprovals ? "earlier approvals were reset" : null,
        updateSha: update.sha,
      },
    }));

  const reviewEntries: TimelineEntry[] = change.reviews.map((review) => ({
    key: `review-${review.id}`,
    kind: reviewKind(review),
    at: timeOf(review.submittedAt),
    thread: null,
    event: {
      actor: personName(review.author),
      verb: reviewVerb(review),
      emphasiseVerb: review.state === "approved",
      tag: null,
      when: formatEventDate(review.submittedAt),
      note: reviewNote(review),
      updateSha: null,
    },
  }));

  const threadEntries: TimelineEntry[] = threads.map((thread) => ({
    key: `thread-${thread.id}`,
    kind: "thread" as const,
    at: timeOf(thread.createdAt),
    thread,
    event: null,
  }));

  const closed: TimelineEntry[] = change.outcome
    ? [
        {
          key: "closed",
          kind: "closed" as const,
          // Closing is the last thing that happened, whatever the clock says
          // about a review submitted in the same second.
          at: Number.MAX_SAFE_INTEGER,
          thread: null,
          event: closingEvent(
            change.outcome,
            change.decidedBy,
            change.publishedVersion,
            formatEventDate(change.closedAt ?? ""),
          ),
        },
      ]
    : [];

  return [
    opened,
    ...updateEntries,
    ...reviewEntries,
    ...threadEntries,
    ...closed,
  ].sort((left, right) => left.at - right.at);
}

/**
 * Which decision the floating pill offers.
 *
 * Only ever one green button. Once a change has the approvals it needs, the
 * reader who can publish it has nothing left to approve, so Publish takes
 * Approve's place rather than sitting beside it asking which of two green
 * buttons they meant. Anyone who *cannot* publish still gets Approve and
 * Request changes: a full approval count does not end the argument, and an
 * objection to an approved change is exactly when one matters most.
 */
export type ReviewDecision = "review" | "publish" | "none";

export function resolveReviewDecision(params: {
  open: boolean;
  isAnonymous: boolean;
  ownSubmission: boolean;
  mergeReady: boolean;
  canReview: boolean;
  canMerge: boolean;
}): ReviewDecision {
  const { open, isAnonymous, ownSubmission, mergeReady, canReview, canMerge } =
    params;

  if (!open || isAnonymous) return "none";
  if (mergeReady && canMerge) return "publish";
  if (ownSubmission) return "none";
  return canReview ? "review" : "none";
}
