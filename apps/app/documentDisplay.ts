/**
 * Presentation helpers shared across the document workspace views.
 *
 * Kept out of the components so the wording of a status, a name, or a date is
 * decided in one place — and can be tested without rendering anything.
 */

import type { VersionReview } from "../../packages/api-schema/schemas/documents";

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

const APPROVAL_STATE_BADGE_CLASSES: Record<string, string> = {
  approved: "vault-status-approved",
  changes_requested: "vault-status-changes",
  in_review: "vault-status-review",
  published: "vault-status-published",
};

export function getApprovalStateBadgeClass(state: string): string {
  return `vault-status-badge ${
    APPROVAL_STATE_BADGE_CLASSES[state] ?? "vault-status-working"
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
      return "vault-status-badge vault-status-approved";
    case "changes_requested":
      return "vault-status-badge vault-status-changes";
    default:
      return "vault-status-badge vault-status-working";
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
  };
}

const CHANGE_OUTCOME_LABELS: Record<ChangeOutcome, string> = {
  published: "Published",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const CHANGE_OUTCOME_BADGE_CLASSES: Record<ChangeOutcome, string> = {
  published: "vault-status-published",
  declined: "vault-status-declined",
  withdrawn: "vault-status-withdrawn",
};

/** The badge on a change: where it stands, or how it ended. */
export function getChangeStateLabel(change: ChangeRecord): string {
  return change.outcome
    ? CHANGE_OUTCOME_LABELS[change.outcome]
    : getApprovalStateLabel(change.approvalState);
}

export function getChangeStateBadgeClass(change: ChangeRecord): string {
  return change.outcome
    ? `vault-status-badge ${CHANGE_OUTCOME_BADGE_CLASSES[change.outcome]}`
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
