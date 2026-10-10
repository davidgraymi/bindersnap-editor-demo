/**
 * A binder's contents as a tree, the way a file explorer shows one.
 *
 * **What this replaces.** The binder listed its documents grouped under a
 * heading per folder, flat — so `nursing/infection/handover` was a heading
 * called "nursing/infection" sitting next to one called "nursing", and nothing
 * said that one was inside the other. Folders nest in the binder (a document's
 * address is a path, and always has been); only the list pretended they did
 * not. A person filing a policy three folders deep then could not see where it
 * went.
 *
 * Two rules decide everything below.
 *
 * **A folder exists because the binder says so, not because something is in
 * it.** Folders come from the tree — a folder with nothing filed in it is a
 * committed `.gitkeep` — so an empty one is a node here like any other. That
 * is the whole point of "folders are real, empty or not": a folder somebody
 * made, had approved and had published has to appear, or the act they went
 * through a change request for did nothing visible.
 *
 * **A folder's intermediate levels are real too.** A document at
 * `nursing/infection/handover` implies `nursing` and `nursing/infection` even
 * if the tree read never named them, which happens whenever a folder holds
 * only other folders. Inferring them here rather than trusting the input keeps
 * the tree connected: the alternative is an orphan node whose parent does not
 * exist and which therefore renders nowhere.
 */

import type { WorkspaceDocumentListEntry } from "../../packages/api-schema/schemas/workspaces";

export interface BinderTreeFolder {
  kind: "folder";
  /** `nursing/infection` — the folder's whole address inside the binder. */
  path: string;
  /** `infection` — what this level is called, which is what a row shows. */
  name: string;
  children: BinderTreeNode[];
  /**
   * Documents at or below this folder.
   *
   * Recursive, because a collapsed folder has to say what it is hiding, and
   * "3" is a worse answer than "12" when the twelve are two levels down.
   */
  documentCount: number;
}

export interface BinderTreeDocument {
  kind: "document";
  document: WorkspaceDocumentListEntry;
}

export type BinderTreeNode = BinderTreeFolder | BinderTreeDocument;

/**
 * Build the tree from what the binder answered with.
 *
 * Folders before documents at every level, each alphabetical — the order a
 * file explorer uses, and the one that makes a deep binder scannable. Sorting
 * is case-insensitive so `Nursing` and `nursing` do not land apart from each
 * other for a reason nobody can see.
 */
export function buildBinderTree(
  documents: readonly WorkspaceDocumentListEntry[],
  folders: readonly string[] = [],
): BinderTreeNode[] {
  const root: BinderTreeFolder = {
    kind: "folder",
    path: "",
    name: "",
    children: [],
    documentCount: 0,
  };
  const byPath = new Map<string, BinderTreeFolder>([["", root]]);

  /** The folder at this path, making it and every level above it if needed. */
  const folderAt = (path: string): BinderTreeFolder => {
    const existing = byPath.get(path);
    if (existing) return existing;

    const cut = path.lastIndexOf("/");
    const parent = folderAt(cut === -1 ? "" : path.slice(0, cut));
    const made: BinderTreeFolder = {
      kind: "folder",
      path,
      name: cut === -1 ? path : path.slice(cut + 1),
      children: [],
      documentCount: 0,
    };
    byPath.set(path, made);
    parent.children.push(made);
    return made;
  };

  // Folders first, so an empty one is in the tree before anything can be
  // filed. A folder named by the tree and a folder implied by a document's
  // path are the same node either way.
  for (const folder of folders) {
    if (folder.trim() !== "") folderAt(folder);
  }

  for (const document of documents) {
    const parent = folderAt(document.folder);
    parent.children.push({ kind: "document", document });

    // Counted up the whole chain, not just onto the parent: a folder's count
    // is what it holds at any depth. Every level exists by now — `folderAt`
    // made the ones that did not.
    for (const path of ["", ...ancestorFolders(document.folder)]) {
      byPath.get(path)!.documentCount += 1;
    }
  }

  sortLevel(root);
  return root.children;
}

/** Folders before documents, each alphabetical, all the way down. */
function sortLevel(folder: BinderTreeFolder): void {
  folder.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return labelOf(left).localeCompare(labelOf(right), undefined, {
      sensitivity: "base",
    });
  });

  for (const child of folder.children) {
    if (child.kind === "folder") sortLevel(child);
  }
}

function labelOf(node: BinderTreeNode): string {
  return node.kind === "folder" ? node.name : node.document.name;
}

/**
 * Every folder path in a tree, for a control that has to offer all of them.
 *
 * Depth-first in display order, so a picker built from this reads down the
 * page the same way the tree does.
 */
export function folderPaths(nodes: readonly BinderTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    paths.push(node.path);
    paths.push(...folderPaths(node.children));
  }
  return paths;
}

/**
 * The folders to open so a path is on screen — its ancestors, not itself.
 *
 * Used when the binder is asked to reveal something: landing on a policy three
 * levels down with every folder shut shows an empty pane and no clue why.
 */
export function ancestorFolders(folder: string): string[] {
  if (folder === "") return [];
  const parts = folder.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * The folders an address is inside — `nursing/infection/handover` is inside
 * `nursing` and `nursing/infection`.
 *
 * The document's own last segment is not a folder, which is the whole
 * difference between this and {@link ancestorFolders}: handing a document's
 * address to that one claims a folder exists that never did.
 */
export function foldersHolding(slugPath: string): string[] {
  const cut = slugPath.lastIndexOf("/");
  return cut === -1 ? [] : ancestorFolders(slugPath.slice(0, cut));
}
