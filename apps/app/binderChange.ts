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
 * What this change does to one document, as a row reads it.
 *
 * **A change request was designed around one document and now routinely holds
 * several**, so the page had one sentence for a list of them: the header said
 * "becomes v2 when published", which is a fact about whichever row happened to
 * be selected, and the rows themselves showed the raw filename — identity
 * segment and all — as if a reader had asked which bytes were on disk.
 *
 * The answer is to say per row what the change does to that document, in the
 * words somebody would use: what it is called, where it is filed, and what
 * happens to it. Three facts, and each is separately true:
 *
 * - `title` — the policy's name, which is what it is.
 * - `effect` — added, versioned, archived: the thing being decided.
 * - `move` — renamed or refiled, when it was. **A rename is a change even
 *   when not a word of the document changed**, and the comparison cannot show
 *   it: the identity survives a rename and the address does not, so two
 *   versions of a renamed policy read identically and the page said "nothing
 *   changed" about a change that plainly did something.
 */
export interface ChangedDocumentFacts {
  title: string;
  /** `nursing/hand-hygiene` — where it is filed, without the identity. */
  address: string;
  effect: string;
  /** "Renamed from Hand Hygiene", "Moved from Nursing", or null. */
  move: string | null;
}

export function describeChangedDocument(
  document: WorkspaceChangedDocument,
  decided = false,
): ChangedDocumentFacts {
  const title = formatDocumentName(document.name);

  const effect = document.currentVersion
    ? decided
      ? `Published v${document.currentVersion.version}`
      : `v${document.currentVersion.version} → v${document.nextVersion}`
    : decided
      ? "Added"
      : `New — becomes v${document.nextVersion}`;

  return {
    title,
    address: document.slugPath,
    effect,
    move: describeMove(document),
  };
}

/**
 * "Renamed from Hand Hygiene", "Moved from Nursing", or both at once.
 *
 * Told apart rather than lumped together as "moved", because they are
 * different acts to the person reading: one changes what a policy is called
 * and the other changes where it is looked for.
 */
export function describeMove(
  document: WorkspaceChangedDocument,
): string | null {
  const was = document.previousSlugPath;
  if (!was || was === document.slugPath) return null;

  const cut = (path: string) => {
    const at = path.lastIndexOf("/");
    return at === -1
      ? { folder: "", name: path }
      : { folder: path.slice(0, at), name: path.slice(at + 1) };
  };

  const from = cut(was);
  const to = cut(document.slugPath);
  const renamed = from.name !== to.name;
  const moved = from.folder !== to.folder;

  const where = (folder: string) =>
    folder === "" ? "the top level" : formatDocumentName(folder);

  if (renamed && moved) {
    return `Renamed from ${formatDocumentName(from.name)} and moved from ${where(from.folder)}`;
  }
  if (renamed) return `Renamed from ${formatDocumentName(from.name)}`;
  return `Moved from ${where(from.folder)}`;
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
    updatedAt: change.updatedAt,
    commentCount: change.commentCount,
    isRejected: change.isRejected,
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
