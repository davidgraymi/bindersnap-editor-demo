/**
 * Where a dragged row is allowed to land, and what act that is.
 *
 * **Pure, and separate from the drop handler, because the rules are the
 * interesting part.** A drag can end anywhere: on the row it started from, on
 * a folder that is already the parent, on a folder inside the one being
 * dragged. Two of those are nothing at all and one is destructive, and telling
 * them apart while also holding a pointer, a drag image and a React state
 * machine is how a filing system loses a folder.
 *
 * **Nothing here is a substitute for the server's refusals.** The planners in
 * `services/api/binderShape.ts` still check every collision, including the
 * address collision that a path check misses — two policies of the same name
 * in different folders have different filenames and the same address. What
 * this decides is whether a drop is worth sending at all, and whether the row
 * under the pointer should light up. A rule is here when it is about the drag
 * itself; a rule is there when it is about the binder.
 */

import type { BinderTreeNode } from "./binderTree";

/**
 * Whether edit mode may act on this row at all.
 *
 * **A file this product did not write cannot be renamed or moved.** Its
 * filename has no identity segment, so the version tags have nothing to be
 * named after (ADR 0005) and the server refuses — correctly, because renaming
 * it would orphan a history it never had. A `README.md` Gitea made with the
 * repository is the case that exists in the wild; a new binder has its deleted
 * at bootstrap, and an older one may still carry it.
 *
 * Asked before the pencil is drawn rather than after it is clicked. Offering a
 * button that fails is the same mistake as lighting up a drop target that will
 * not take the drop, and this file already refuses to do the second one.
 *
 * Folders are always editable: a folder is a path, not a file, and it has no
 * identity to be missing.
 */
export function isManaged(node: BinderTreeNode): boolean {
  return node.kind === "folder" || node.document.uid !== null;
}

/** What is being dragged. Its own address, and enough to name it in a message. */
export type DragSubject =
  | { kind: "document"; slugPath: string; folder: string }
  | { kind: "folder"; path: string };

/**
 * What to do about a drop.
 *
 * `null` is the common answer and not a failure: dropping a policy back in the
 * folder it came from is a drag somebody thought better of, and it should cost
 * nothing and say nothing.
 */
export type MovePlan =
  | { kind: "document"; slugPath: string; folder: string }
  | { kind: "folder"; from: string; to: string }
  | { kind: "refused"; why: string }
  | null;

/**
 * Drop `subject` into `folder` — `""` being the binder's top level.
 *
 * The folder is named by its path rather than by a node, so the root drop zone
 * and a folder row ask the same question.
 */
export function planMove(subject: DragSubject, folder: string): MovePlan {
  if (subject.kind === "document") {
    if (subject.folder === folder) return null;
    return { kind: "document", slugPath: subject.slugPath, folder };
  }

  const from = subject.path;

  // Onto itself. Common, because a folder row is a large target and a small
  // drag does not leave it.
  if (from === folder) return null;

  // **Inside itself.** Every file under it would land at a path that is about
  // to stop existing. Git would take it and nobody meant it, so it is refused
  // rather than passed on — and refused *here* as well as on the server,
  // because the row has to not light up while the pointer is over it.
  if (folder.startsWith(`${from}/`)) {
    return { kind: "refused", why: "A folder cannot be moved inside itself." };
  }

  const name = from.slice(from.lastIndexOf("/") + 1);
  const to = folder === "" ? name : `${folder}/${name}`;

  // Already there — dropped on the parent it is already in.
  if (to === from) return null;

  return { kind: "folder", from, to };
}

/** Whether a drop here would do something, for lighting the row up. */
export function acceptsDrop(subject: DragSubject, folder: string): boolean {
  const plan = planMove(subject, folder);
  return plan !== null && plan.kind !== "refused";
}
