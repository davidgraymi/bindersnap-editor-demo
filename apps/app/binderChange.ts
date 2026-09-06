/**
 * What a binder change's page shows, decided away from the rendering.
 *
 * ADR 0004: "the unit of approval is the change, not the document." So this is
 * about a change — what it would do to each document it touches, and what is
 * standing between it and the record — rather than about any one document.
 */

import { parsePositiveIntParam } from "./binderDocument";
import { formatDocumentName } from "./documentDisplay";
import type { PullRequestWithApprovalState } from "../../packages/api-schema/schemas/documents";
import type {
  WorkspaceChangeSummary,
  WorkspaceChangedDocument,
} from "../../packages/api-schema/schemas/workspaces";
import type { ChangeRecord } from "./documentDisplay";
import { describeSubmission, parseChangeTitle } from "./documentDisplay";

/**
 * Which change the address bar is asking for, or null for the binder itself.
 *
 * In the query rather than the path because `/{org}/{binder}/changes/3` cannot
 * be told apart from a policy filed at `changes/3` — the same reason the
 * document page reads `?version=`. And on the binder rather than on a
 * document, because a change can touch several and belongs to none of them.
 */
export function parseRequestedChange(search: string): number | null {
  return parsePositiveIntParam(search, "change");
}

/** `/{org}/{binder}?change=3`, or the binder when no change is open. */
export function buildChangeUrl(params: {
  org: string;
  binder: string;
  changeNumber: number | null;
}): string {
  const { org, binder, changeNumber } = params;
  const base = `/${org}/${binder}`;
  return changeNumber === null ? base : `${base}?change=${changeNumber}`;
}

/**
 * "Hand Hygiene · v2 → v3", or "Hand Hygiene · new, will be v1".
 *
 * Once the change has been decided the arrow is a lie: the version on record
 * *is* what this change wrote, and the next one belongs to somebody else's
 * change. So a decided change names what it published instead.
 */
export function describeVersionStep(
  document: WorkspaceChangedDocument,
  decided = false,
): string {
  const name = formatDocumentName(document.name);

  if (decided) {
    return document.currentVersion
      ? `${name} · v${document.currentVersion.version}`
      : name;
  }

  return document.currentVersion
    ? `${name} · v${document.currentVersion.version} → v${document.nextVersion}`
    : `${name} · new, will be v${document.nextVersion}`;
}

/**
 * Why this change cannot be published yet, or null when it can.
 *
 * Said before the button is pressed rather than after. Gitea is still the
 * authority — it refuses the merge itself — but a person who has to press a
 * button to find out what is wrong has been told nothing.
 */
export function describePublishBlock(params: {
  change: Pick<
    PullRequestWithApprovalState,
    | "state"
    | "isApproved"
    | "isRejected"
    | "approvalCount"
    | "requiredApprovals"
  >;
  /** `main` moved on after this change branched off it. */
  isBehind: boolean;
  blockOnUnresolvedThreads: boolean;
  unresolvedThreadCount: number;
  documentCount: number;
}): string | null {
  const {
    change,
    isBehind,
    blockOnUnresolvedThreads,
    unresolvedThreadCount,
    documentCount,
  } = params;

  // A change that has already been decided has nothing standing in its way.
  // Without this the page keeps offering the blockers of a change that no
  // longer exists — telling somebody to bring a merged change up to date.
  if (change.state !== "open") return null;

  if (documentCount === 0) {
    return "This change does not touch any document.";
  }

  // Ahead of everything else on purpose. A binder refuses to merge a change
  // that is behind however many approvals it has, and bringing it up to date
  // dismisses those approvals — so collecting them first is wasted work.
  if (isBehind) {
    return "The binder has moved on since this change was made. Bring it up to date before publishing.";
  }

  if (change.isRejected) {
    return "A reviewer has asked for changes. Publishing is held until they approve.";
  }

  const required = change.requiredApprovals ?? 0;
  if (change.approvalCount < required) {
    const short = required - change.approvalCount;
    return short === 1
      ? "One more approval is needed before this can be published."
      : `${short} more approvals are needed before this can be published.`;
  }

  if (blockOnUnresolvedThreads && unresolvedThreadCount > 0) {
    return unresolvedThreadCount === 1
      ? "One discussion thread is still open. Resolve it before publishing."
      : `${unresolvedThreadCount} discussion threads are still open. Resolve them before publishing.`;
  }

  return null;
}

/**
 * What publishing wrote, in one line: "Published v3 of Hand Hygiene."
 *
 * Named per document because a change that touched three publishes three
 * versions, and "Published" alone would hide which.
 */
export function describePublished(
  tags: Array<{ tag: string; version: number }>,
): string {
  if (tags.length === 0) return "Published.";

  const named = tags.map((tag) => {
    const slugPath = tag.tag.replace(/\/v\d+$/, "");
    const name = slugPath.slice(slugPath.lastIndexOf("/") + 1);
    return `v${tag.version} of ${formatDocumentName(name)}`;
  });

  return `Published ${named.join(", ")}.`;
}

/**
 * A binder's change, as the shared change list and change page read it.
 *
 * One mapping for open and closed alike. The old model needed two —
 * `toChangeRecord` and `closedChangeToRecord` — because the server sent two
 * shapes, and that is how a field came to be set in one of them and not the
 * other.
 */
export function workspaceChangeToRecord(
  change: WorkspaceChangeSummary,
): ChangeRecord {
  const open = change.outcome === "open";

  return {
    number: change.number,
    summary: parseChangeTitle(change.body, change.submittedBy),
    description: describeSubmission(change.body),
    reviews: change.reviews,
    branchName: change.branchName.trim() || null,
    submittedBy: change.submittedBy,
    submittedAt: change.submittedAt,
    open,
    approvalState: change.approvalState,
    // `outcome` is how a change *ended*, so an open one has none — the wider
    // enum on the wire carries "open" only so one shape serves both lists.
    outcome: change.outcome === "open" ? null : change.outcome,
    closedAt: change.closedAt,
    decidedBy: change.decidedBy,
    // Per document in a binder, so the row names them rather than claiming one
    // number for a change that may have published three.
    publishedVersion: null,
    assignee: change.assignee,
    reviewers: change.reviewers,
    approvalCount: change.approvalCount,
    requiredApprovals: change.requiredApprovals,
  };
}

/**
 * What a change row says it is about: "Hand Hygiene", or "Hand Hygiene v2"
 * once it has published one.
 *
 * The old row said "becomes v4 when published", which a binder cannot: one
 * change can touch three documents, and they do not advance in lockstep.
 */
export function describeChangeDocuments(
  change: Pick<WorkspaceChangeSummary, "documents">,
): string | null {
  if (change.documents.length === 0) return null;

  return change.documents
    .map((document) => {
      const name = formatDocumentName(document.name);
      return document.version === null ? name : `${name} v${document.version}`;
    })
    .join(", ");
}
