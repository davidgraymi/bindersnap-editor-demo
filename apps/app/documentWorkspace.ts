import type {
  DocTag,
  PullRequestWithApprovalState,
  RepoCollaboratorPermissionSummary,
} from "./api";
import {
  capitalizeFirst,
  describeApprovalProgress,
  formatShortDate,
  getInitials,
  parseChangeTitle,
} from "./documentDisplay";
import { formatWhen } from "./homeChanges";

/**
 * Everything the document workspace header and rail say, derived here.
 *
 * The page itself only renders. What a version pill reads, which three
 * changes the rail is willing to show, and the one meta sentence under each
 * of them are decisions — so they are made in one place and tested without a
 * browser.
 */

/** The version on record, as the header states it. */
export interface DocumentHeaderFacts {
  /** "v3 · Current", or "No version yet" before anything is published. */
  versionLabel: string;
  /** Green only once something is actually on the record. */
  tone: "current" | "none";
  /** "Approved Jan 12, 2026", or why there is no such date. */
  approvedLine: string;
  /** The file the document is, in mono. Null when it cannot be resolved. */
  fileName: string | null;
}

export function buildDocumentHeaderFacts(params: {
  latestTag: Pick<DocTag, "version" | "created"> | null;
  fileName: string | null;
}): DocumentHeaderFacts {
  const { latestTag, fileName } = params;

  if (!latestTag) {
    return {
      versionLabel: "No version yet",
      tone: "none",
      approvedLine: "Nothing published yet",
      fileName,
    };
  }

  return {
    versionLabel: `v${latestTag.version} · Current`,
    tone: "current",
    approvedLine: `Approved ${formatShortDate(latestTag.created)}`,
    fileName,
  };
}

/** One open change, as the rail states it. */
export interface PendingDecisionRow {
  key: string;
  number: number;
  /** What the change is called. */
  title: string;
  /** "Maya · 2h ago · 2 of 3 approvals" — one sentence, three facts. */
  meta: string;
}

/**
 * The changes still waiting on somebody, newest first.
 *
 * The rail is 280px wide and sits beside the document itself; it is a nudge,
 * not the Changes tab. Three is as many as it will ever show.
 */
export function buildPendingDecisionRows(
  openPullRequests: PullRequestWithApprovalState[],
  now: number = Date.now(),
  limit = 3,
): PendingDecisionRow[] {
  return openPullRequests.slice(0, limit).map((pullRequest) => {
    const submittedBy = pullRequest.user?.login ?? "";
    const facts = [
      capitalizeFirst(submittedBy) || "Someone",
      formatWhen(pullRequest.created_at ?? "", now),
      describeApprovalProgress({
        approvalCount: pullRequest.approvalCount ?? 0,
        requiredApprovals: pullRequest.requiredApprovals ?? null,
      }) ?? "no approvals needed",
    ];

    return {
      key: `change-${pullRequest.number}`,
      number: pullRequest.number,
      title: parseChangeTitle(pullRequest.body, submittedBy),
      meta: facts.join(" · "),
    };
  });
}

/** One published version, as the rail lists it. */
export interface VersionRailRow {
  key: string;
  tagName: string;
  version: number;
  /** "v3" — the pill on the left of the row. */
  label: string;
  /** "Jan 12, 2026". */
  date: string;
  /** The one row that is the document as it stands. */
  current: boolean;
}

export function buildVersionRailRows(
  tags: DocTag[],
  limit = 4,
): VersionRailRow[] {
  return tags.slice(0, limit).map((tag, index) => ({
    key: tag.name,
    tagName: tag.name,
    version: tag.version,
    label: `v${tag.version}`,
    date: formatShortDate(tag.created),
    // The list arrives newest first, so the first row is the record.
    current: index === 0,
  }));
}

/** One face in the rail's team row. */
export interface TeamAvatar {
  key: string;
  /** "MK". */
  initials: string;
  /** The tooltip and the screen-reader name. */
  name: string;
}

/**
 * Who is on this document, owner first.
 *
 * The rail shows faces, not a table — the table is one click away under
 * Access & approvals. Anything past the fifth face becomes a "+N" the row
 * renders itself, so this hands back everyone and lets the page cut.
 */
export function buildTeamAvatars(
  collaborators: RepoCollaboratorPermissionSummary[],
  owner: string,
): TeamAvatar[] {
  const seen = new Set<string>();
  const avatars: TeamAvatar[] = [];

  const push = (login: string, fullName: string) => {
    const key = login.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const name = fullName.trim() || capitalizeFirst(login);
    avatars.push({ key: login, initials: getInitials(name), name });
  };

  push(owner, "");
  for (const collaborator of collaborators) {
    push(collaborator.user.login, collaborator.user.full_name);
  }

  return avatars;
}
