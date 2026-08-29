/**
 * Presentation helpers shared across the document workspace views.
 *
 * Kept out of the components so the wording of a status, a name, or a date is
 * decided in one place — and can be tested without rendering anything.
 */

import type {
  ChangeReviewer,
  ChangeUser,
  ReviewerStatus,
  VersionReview,
} from "../../packages/api-schema/schemas/documents";

export type DocumentStatus =
  "published" | "in_review" | "changes_requested" | "approved" | "draft";

/** "quarterly-report" → "Quarterly Report". */
export function formatDocumentName(repoName: string): string {
  return repoName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDate(timestamp: string): string {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatShortDate(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const APPROVAL_STATE_LABELS: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes Requested",
  in_review: "Awaiting Approval",
  published: "Published",
};

export function getApprovalStateLabel(state: string): string {
  return APPROVAL_STATE_LABELS[state] ?? "Draft";
}

const APPROVAL_STATE_BADGE_TONES: Record<string, string> = {
  approved: "bs-status--approved",
  changes_requested: "bs-status--changes",
  in_review: "bs-status--review",
  published: "bs-status--published",
};

export function getApprovalStateBadgeClass(state: string): string {
  return `bs-status ${
    APPROVAL_STATE_BADGE_TONES[state] ?? "bs-status--working"
  }`;
}

/**
 * The one-line answer to "where does this document stand right now?"
 *
 * A document page has room to say that a version is published *and* another is
 * in review; a row in a list does not, so a list has to pick one word. This
 * picks it, worst news first: an open change asking for work outranks an open
 * change that is ready, which outranks anything already on the record.
 */
export function resolveDocumentStatus(params: {
  hasPublishedVersion: boolean;
  openApprovalStates: string[];
}): DocumentStatus {
  const { hasPublishedVersion, openApprovalStates } = params;

  if (openApprovalStates.includes("changes_requested")) {
    return "changes_requested";
  }
  if (openApprovalStates.includes("approved")) return "approved";
  if (openApprovalStates.length > 0) return "in_review";
  return hasPublishedVersion ? "published" : "draft";
}

/**
 * The same question, asked of a row in the workspace document list.
 *
 * Structurally typed rather than importing `WorkspaceDocumentSummary`, so this
 * module stays free of schema imports and testable with a plain object.
 */
export function resolveWorkspaceDocumentStatus(doc: {
  latestTag: unknown | null;
  pendingPRs: { approvalState: string }[];
}): DocumentStatus {
  return resolveDocumentStatus({
    hasPublishedVersion: doc.latestTag !== null,
    openApprovalStates: doc.pendingPRs.map((pr) => pr.approvalState),
  });
}

export function getDocumentStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case "published":
      return "Published";
    case "approved":
      return "Ready to publish";
    case "changes_requested":
      return "Changes requested";
    case "in_review":
      return "In review";
    default:
      return "Draft";
  }
}

export function getReviewStateLabel(
  state: "approved" | "changes_requested" | "commented" | "other",
): string {
  switch (state) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Requested changes";
    case "commented":
      return "Commented";
    default:
      return "Reviewed";
  }
}

export function getReviewStateBadgeClass(
  state: "approved" | "changes_requested" | "commented" | "other",
): string {
  switch (state) {
    case "approved":
      return "bs-status bs-status--approved";
    case "changes_requested":
      return "bs-status bs-status--changes";
    default:
      return "bs-status bs-status--working";
  }
}

/**
 * Turn Bindersnap's auto-generated pull request body into something a person
 * would write. Returns null when the body carries nothing worth showing.
 */
export function parseSubmissionSummary(
  body: string | null | undefined,
): string | null {
  if (!body) return null;

  if (!body.includes("Automated upload from Bindersnap")) {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const file = body.match(/Source file:\s*(\S+)/)?.[1] ?? null;
  const user = body.match(/Uploaded by:\s*(\S+)/)?.[1] ?? null;

  if (user && file) return `Submitted by ${capitalizeFirst(user)} · ${file}`;
  if (user) return `Submitted by ${capitalizeFirst(user)}`;
  return file;
}

/** Initials for an avatar fallback: "Dana Reyes" → "DR". */
export function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * Which of five tints a person's avatar takes.
 *
 * Faces in this product are usually initials — most people never upload a
 * photo — and a wall of identical grey circles makes a reviewer list something
 * you have to read rather than recognise. The tint is derived from the login
 * so the same person is the same colour on every screen, every session.
 */
export type AvatarTone = 1 | 2 | 3 | 4 | 5;

export function getAvatarTone(login: string): AvatarTone {
  let sum = 0;
  for (let index = 0; index < login.length; index += 1) {
    sum = (sum + login.charCodeAt(index)) % 5;
  }
  return ((sum % 5) + 1) as AvatarTone;
}

/**
 * One change, whatever list it came from.
 *
 * An open change arrives as a Gitea pull request and a closed one as the
 * server's already-decided record of how it ended. The Changes tab and a
 * change's own page should not have to care which — they show the same row,
 * the same header, the same discussion — so both are narrowed to this.
 */
export interface ChangeRecord {
  number: number;
  /** What the row and the page call it, already humanised. */
  summary: string;
  /** What the submitter wrote, as they wrote it. */
  description: string;
  /** Every review on the change, oldest first. */
  reviews: VersionReview[];
  /** The branch the submitted file lives on, or null once it is gone. */
  branchName: string | null;
  submittedBy: string;
  submittedAt: string;
  open: boolean;
  /** Where an open change stands. Meaningless once it is closed. */
  approvalState: string;
  /** How a closed change ended. Null while it is still open. */
  outcome: ChangeOutcome | null;
  closedAt: string | null;
  /** Who published it, or who asked for changes it never came back from. */
  decidedBy: string | null;
  /** The version a published change became. */
  publishedVersion: number | null;
  /** The one person answerable for the change, when someone is. */
  assignee: ChangeUser | null;
  /** Who has to sign this off, and where each of them stands. */
  reviewers: ChangeReviewer[];
  /** Approvals that still count. */
  approvalCount: number;
  /**
   * How many approvals this document demands before anything can publish, or
   * null when the server could not read the policy. A document that demands
   * none reports 0 — the two are different answers and only one of them means
   * "nothing left to collect".
   */
  requiredApprovals: number | null;
}

export type ChangeOutcome = "published" | "declined" | "withdrawn";

/**
 * What to call a change in a list.
 *
 * The row already says who submitted it and when, so a title that also says
 * "Submitted by Alice" is the same sentence twice. A generated upload is named
 * after the file it carries; anything a person wrote is used as written.
 */
export function parseChangeTitle(
  body: string | null | undefined,
  submittedBy: string,
): string {
  const fallback = `Submitted by ${capitalizeFirst(submittedBy || "someone")}`;
  if (!body) return fallback;

  if (!body.includes("Automated upload from Bindersnap")) {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  const file = body.match(/Source file:\s*(\S+)/)?.[1] ?? null;
  return file ? `New version of ${file}` : fallback;
}

/**
 * What the submitter said, for the opening post of the discussion.
 *
 * A body a person typed is theirs and is shown as typed. The generated upload
 * body is machinery — "Automated upload from Bindersnap file vault. File hash
 * (SHA-256): 76ff…" — and nobody opens a review to read it, so it is reduced
 * to the one fact it carries: which file was submitted.
 */
export function describeSubmission(body: string | null | undefined): string {
  if (!body) return "";
  if (!body.includes("Automated upload from Bindersnap")) return body.trim();

  const file = body.match(/Source file:\s*(\S+)/)?.[1] ?? null;
  return file ? `Submitted ${file} for review.` : "";
}

export function toChangeRecord(pullRequest: {
  number?: number;
  body?: string;
  branchName?: string;
  created_at?: string;
  approvalState: string;
  reviews?: VersionReview[];
  reviewers?: ChangeReviewer[];
  assignee?: ChangeUser | null;
  approvalCount?: number;
  requiredApprovals?: number | null;
  user?: { login: string } | null;
}): ChangeRecord {
  const submittedBy = pullRequest.user?.login ?? "";
  return {
    number: pullRequest.number ?? 0,
    summary: parseChangeTitle(pullRequest.body, submittedBy),
    description: describeSubmission(pullRequest.body),
    reviews: pullRequest.reviews ?? [],
    branchName: pullRequest.branchName?.trim() || null,
    submittedBy,
    submittedAt: pullRequest.created_at ?? "",
    open: true,
    approvalState: pullRequest.approvalState,
    outcome: null,
    closedAt: null,
    decidedBy: null,
    publishedVersion: null,
    assignee: pullRequest.assignee ?? null,
    reviewers: pullRequest.reviewers ?? [],
    approvalCount: pullRequest.approvalCount ?? 0,
    requiredApprovals: pullRequest.requiredApprovals ?? null,
  };
}

export function closedChangeToRecord(change: {
  number: number;
  body: string;
  branchName: string;
  submittedBy: string;
  submittedAt: string;
  closedAt: string | null;
  outcome: ChangeOutcome;
  decidedBy: string | null;
  publishedVersion: number | null;
  reviews?: VersionReview[];
  reviewers?: ChangeReviewer[];
  assignee?: ChangeUser | null;
  approvalCount?: number;
  requiredApprovals?: number | null;
}): ChangeRecord {
  return {
    number: change.number,
    summary: parseChangeTitle(change.body, change.submittedBy),
    description: describeSubmission(change.body),
    reviews: change.reviews ?? [],
    branchName: change.branchName.trim() || null,
    submittedBy: change.submittedBy,
    submittedAt: change.submittedAt,
    open: false,
    approvalState: change.outcome === "published" ? "published" : "working",
    outcome: change.outcome,
    closedAt: change.closedAt,
    decidedBy: change.decidedBy,
    publishedVersion: change.publishedVersion,
    assignee: change.assignee ?? null,
    reviewers: change.reviewers ?? [],
    approvalCount: change.approvalCount ?? 0,
    requiredApprovals: change.requiredApprovals ?? null,
  };
}

/**
 * Where a reviewer stands, as the page shows it.
 *
 * The server's four states plus one it cannot see: an unresolved thread this
 * person started. Publication is gated on those threads, so the person holding
 * one open is blocking the change every bit as much as one who asked for
 * changes — and the page should say so rather than leaving them looking done.
 */
export type ReviewerDisplayStatus = ReviewerStatus | "thread_open";

/**
 * One reviewer, one icon.
 *
 * Read worst news first: someone who asked for changes is blocking, and so is
 * someone with a thread still open, whatever they said in their review. Below
 * that, an approval outranks a bare comment, and "awaiting" is what is left.
 */
export function resolveReviewerDisplayStatus(
  reviewer: { login: string; status: ReviewerStatus },
  openThreadAuthors: ReadonlySet<string> = new Set(),
): ReviewerDisplayStatus {
  if (reviewer.status === "changes_requested") return "changes_requested";
  if (openThreadAuthors.has(reviewer.login)) return "thread_open";
  return reviewer.status;
}

const REVIEWER_STATUS_LABELS: Record<ReviewerDisplayStatus, string> = {
  approved: "Approved",
  changes_requested: "Asked for changes",
  thread_open: "Has an open thread",
  commented: "Commented",
  awaiting: "Awaiting review",
};

export function getReviewerStatusLabel(status: ReviewerDisplayStatus): string {
  return REVIEWER_STATUS_LABELS[status];
}

/** The name to put next to the icon. A real name beats a username. */
export function getReviewerDisplayName(reviewer: {
  login: string;
  fullName: string;
}): string {
  return reviewer.fullName.trim() || capitalizeFirst(reviewer.login);
}

/**
 * How close a change is to being publishable, in the one form that answers it:
 * approvals collected against approvals required.
 *
 * "Awaiting review" says a decision is outstanding without saying how much is
 * outstanding — one more sign-off and three more are the same badge. Returns
 * null when the document demands no approvals, because "0 of 0" is noise, and
 * when the requirement is unknown, because a denominator is the whole point.
 */
export function describeApprovalProgress(change: {
  approvalCount: number;
  requiredApprovals: number | null;
}): string | null {
  const required = change.requiredApprovals;
  if (required === null || required <= 0) return null;
  return `${change.approvalCount} of ${required} approvals`;
}

/** True once a change has collected every approval it needs. */
export function hasEnoughApprovals(change: {
  approvalCount: number;
  requiredApprovals: number | null;
}): boolean {
  const required = change.requiredApprovals;
  return required !== null && required > 0 && change.approvalCount >= required;
}

/**
 * Whether the change is moving, stuck, or done — the one thing that decides
 * how the standing pill is coloured.
 */
export type ChangeStandingTone = "blocked" | "ready" | "progress";

export interface ChangeStanding {
  tone: ChangeStandingTone;
  /** "1 of 2 approvals", or null when the document demands none. */
  progress: string | null;
  /** Why it stands there, in the fewest words that name a person. */
  reason: string;
}

/** "Bob", "Bob and Carol", "Bob, Carol and 2 others". */
function joinNames(reviewers: { login: string; fullName: string }[]): string {
  const names = reviewers.map(getReviewerDisplayName);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${
    names.length - 2 === 1 ? "" : "s"
  }`;
}

/**
 * Where an open change stands, as one sentence.
 *
 * The count and the state badge were two components each answering "can this
 * publish?" separately, and they contradicted each other the moment a reviewer
 * approved and *then* asked for changes: Gitea keeps both, so the page showed a
 * red CHANGES REQUESTED beside a green 1 of 1 approvals. A reader cannot act on
 * that. One pill owns the question now, and it reports the worst news first —
 * a blocker outranks a full count, because a full count cannot publish past it.
 *
 * Returns null for a closed change (its outcome is the whole story) and for a
 * document that demands no approvals — or whose policy could not be read — and
 * has no blocker, where there is simply nothing to report. The caller falls
 * back to the state badge in that case.
 */
export function describeChangeStanding(
  change: ChangeRecord,
  openThreadAuthors: ReadonlySet<string> = new Set(),
): ChangeStanding | null {
  if (!change.open) return null;

  const progress = describeApprovalProgress(change);
  const standingOf = (reviewer: ChangeReviewer) =>
    resolveReviewerDisplayStatus(reviewer, openThreadAuthors);

  const refusing = change.reviewers.filter(
    (reviewer) => standingOf(reviewer) === "changes_requested",
  );
  if (refusing.length > 0) {
    return {
      tone: "blocked",
      progress,
      reason: `${joinNames(refusing)} asked for changes`,
    };
  }

  const talking = change.reviewers.filter(
    (reviewer) => standingOf(reviewer) === "thread_open",
  );
  if (talking.length > 0) {
    return {
      tone: "blocked",
      progress,
      reason: `${joinNames(talking)} left a thread open`,
    };
  }

  if (hasEnoughApprovals(change)) {
    return { tone: "ready", progress, reason: "Ready to publish" };
  }

  if (progress === null) return null;

  const missing = (change.requiredApprovals ?? 0) - change.approvalCount;
  const waiting = change.reviewers.filter(
    (reviewer) => standingOf(reviewer) === "awaiting",
  );
  return {
    tone: "progress",
    progress,
    reason:
      waiting.length > 0
        ? `Waiting on ${joinNames(waiting)}`
        : `${missing} more approval${missing === 1 ? "" : "s"} needed`,
  };
}

const CHANGE_OUTCOME_LABELS: Record<ChangeOutcome, string> = {
  published: "Published",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const CHANGE_OUTCOME_BADGE_TONES: Record<ChangeOutcome, string> = {
  published: "bs-status--published",
  declined: "bs-status--changes",
  withdrawn: "bs-status--working",
};

/** The badge on a change: where it stands, or how it ended. */
export function getChangeStateLabel(change: ChangeRecord): string {
  return change.outcome
    ? CHANGE_OUTCOME_LABELS[change.outcome]
    : getApprovalStateLabel(change.approvalState);
}

export function getChangeStateBadgeClass(change: ChangeRecord): string {
  return change.outcome
    ? `bs-status ${CHANGE_OUTCOME_BADGE_TONES[change.outcome]}`
    : getApprovalStateBadgeClass(change.approvalState);
}

/**
 * The line under a change's title: who asked for what, and what came of it.
 *
 * A closed change's reason is the whole point of showing it — "closed" on its
 * own is the answer to a question nobody asked.
 */
export function describeChangeOutcome(change: ChangeRecord): string | null {
  if (!change.outcome) return null;

  const when = change.closedAt ? formatShortDate(change.closedAt) : null;
  const who = change.decidedBy ? capitalizeFirst(change.decidedBy) : null;

  switch (change.outcome) {
    case "published": {
      const version =
        change.publishedVersion === null
          ? "Published"
          : `Published as v${change.publishedVersion}`;
      return [version, who ? `by ${who}` : null, when ? `on ${when}` : null]
        .filter(Boolean)
        .join(" ");
    }
    case "declined":
      return [
        "Declined",
        who ? `after ${who} requested changes` : "after changes were requested",
        when ? `· closed ${when}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return ["Withdrawn without a decision", when ? `· closed ${when}` : null]
        .filter(Boolean)
        .join(" ");
  }
}
