/**
 * Presentation helpers shared across the document workspace views.
 *
 * Kept out of the components so the wording of a status, a name, or a date is
 * decided in one place — and can be tested without rendering anything.
 */

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
 * The one-line answer to "where does this document stand right now?" — the
 * question the whole page exists to answer, so it is derived once and shown in
 * the header rather than inferred from three separate cards.
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
      return "No version yet";
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
