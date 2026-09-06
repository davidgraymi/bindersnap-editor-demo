/**
 * What a binder change's page shows, decided away from the rendering.
 *
 * ADR 0004: "the unit of approval is the change, not the document." So this is
 * about a change — what it would do to each document it touches, and what is
 * standing between it and the record — rather than about any one document.
 */

import { parsePositiveIntParam } from "./binderDocument";
import { formatDocumentName } from "./documentDisplay";
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
