/**
 * What Edit does on the version of the binder being read.
 *
 * **Edit writes where you are.** The binder, a folder and a document can each
 * be read at the record, at one of your drafts, or at a change request's
 * branch, and every one of those pages offers Edit. It opens the editor on
 * the same place in the same version, when that version is one you may write:
 *
 * - the record: your draft (the newest, or a new one), as it always has;
 * - one of your drafts, proposed or not: that draft — a save into a proposed
 *   one lands in its change, like a commit pushed to a branch with a pull
 *   request open on it;
 * - a change request you are the author or a co-editor of: that change;
 * - anybody else's branch: not theirs to write, so Edit opens your own draft
 *   at the same place — and on a document, asks first (`editChoices.ts`).
 */

import { isEditorDocumentFile } from "./binderDocument";

export type BranchEdit =
  | { kind: "record" }
  | { kind: "draft"; branch: string }
  | { kind: "change"; number: number; branch: string }
  /** Somebody else's: the change on it, when one is open. */
  | { kind: "theirs"; number: number | null }
  /** The open changes are still being read. */
  | { kind: "unknown" };

/**
 * Whether a branch is one of this person's drafts — read from its name,
 * which says whose it is (`draft/<login>/<stamp>`), so the answer does not
 * wait on a list of drafts still being fetched. The server checks it again.
 */
export function ownsDraftBranch(branch: string, user: string): boolean {
  const [kind, owner, stamp, ...rest] = branch.split("/");
  return (
    kind === "draft" && owner === user && Boolean(stamp) && rest.length === 0
  );
}

export function branchEditTarget(
  ref: string | null,
  user: string,
  openChanges:
    | readonly { number: number; branchName: string; viewerCanEdit: boolean }[]
    | null,
): BranchEdit {
  if (ref === null) return { kind: "record" };
  if (ownsDraftBranch(ref, user)) return { kind: "draft", branch: ref };
  if (openChanges === null) return { kind: "unknown" };
  const change = openChanges.find((entry) => entry.branchName === ref);
  if (change?.viewerCanEdit) {
    return { kind: "change", number: change.number, branch: ref };
  }
  return { kind: "theirs", number: change?.number ?? null };
}

/**
 * The policy Edit opens on a change request's branch from the binder's page
 * or a folder's: one the change touches, in that folder, first; then any
 * the editor writes there. Null when there is none — a folder of Word files
 * and PDFs, which are revised from the change by a new upload.
 */
export function policyToWriteInChange(
  documents: readonly { path: string; slugPath: string }[],
  touched: readonly string[],
  folder: string | null,
): string | null {
  const inFolder = (slugPath: string) =>
    !folder || slugPath.startsWith(`${folder}/`);
  const writable = documents.filter(
    (entry) => isEditorDocumentFile(entry.path) && inFolder(entry.slugPath),
  );
  const changed = writable.find((entry) => touched.includes(entry.slugPath));
  if (changed) return changed.slugPath;
  const depth = (slugPath: string) => slugPath.split("/").length;
  const first = [...writable].sort(
    (a, b) =>
      depth(a.slugPath) - depth(b.slugPath) ||
      a.slugPath.localeCompare(b.slugPath),
  )[0];
  return first?.slugPath ?? null;
}
