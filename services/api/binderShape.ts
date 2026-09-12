/**
 * The acts that change a binder's shape rather than its contents.
 *
 * Making a folder, renaming one, renaming a policy, filing it somewhere else.
 * None of them changes a single byte of a document; all of them change where
 * things are, which is what a filing system is mostly for and what this product
 * could not do at all.
 *
 * **Each one is a list of file operations**, worked out here and committed by
 * `binderFiles.ts` as one commit inside one change request. Renaming a folder
 * of twelve policies is twelve moves and exactly one act — a reviewer should
 * see it that way, and it must not be able to half-apply.
 *
 * **A renamed folder keeps every version inside it**, which is the whole reason
 * ADR 0005 came first. A document's identity is a segment of its filename and
 * moves with the file, so a policy that lands at a new path is the same policy
 * on its next version rather than a new one starting at v1 with every tag it
 * had orphaned behind it. Renaming could not be shipped before that.
 */

import {
  normalizeFolderSegments,
  parseDocumentFilename,
} from "../../packages/utils/documentPath";

import type { BinderFileOperation } from "./gitea-client/binderFiles";
/**
 * What a folder made on purpose leaves behind.
 *
 * Git has no empty directories: a folder exists because a file is in it. So a
 * folder somebody made and has not filed anything in yet is this file, and
 * nothing else. It is named the way every tool that has faced the same problem
 * names it, and it is filtered out of the documents like the rest of the
 * repository's furniture.
 */
export const FOLDER_KEEP_FILE = ".gitkeep";

/** `nursing/ward-3` → the path the placeholder goes at. */
export function folderKeepPath(folder: string): string {
  return `${folder}/${FOLDER_KEEP_FILE}`;
}

/** A folder as the binder stores it: slugged segments, no leading or trailing slash. */
export function normalizeFolder(folder: string): string {
  return normalizeFolderSegments(folder).join("/");
}

export interface ShapeChange {
  operations: BinderFileOperation[];
  /** What the change request is called, in the customer's language. */
  title: string;
  /** The commit message. One commit, so one message. */
  message: string;
}

export type ShapeChangeResult = ShapeChange | { error: string };

/**
 * Make a folder.
 *
 * Refused when the binder already has one, because "make" would then mean
 * "nothing", and a change request that does nothing merges cleanly and leaves
 * somebody wondering what happened.
 */
export function planNewFolder(params: {
  folder: string;
  existingFolders: readonly string[];
}): ShapeChangeResult {
  const folder = normalizeFolder(params.folder);

  if (folder === "") {
    return {
      error: "A folder needs a name with letters or numbers in it.",
    };
  }

  if (params.existingFolders.includes(folder)) {
    return { error: `This binder already has a folder called “${folder}”.` };
  }

  return {
    // Empty content: the file is a marker, and anything inside it would be
    // something a reader could open and be confused by.
    operations: [
      { kind: "write", path: folderKeepPath(folder), base64Content: "" },
    ],
    title: `Add the folder ${folder}`,
    message: `Add the folder ${folder}`,
  };
}

/**
 * Rename a folder, or move it under another one.
 *
 * Every file beneath it moves, including the placeholder that may be holding it
 * open — so a folder somebody made and never filed anything in can still be
 * renamed, which is the least surprising thing and would not work if this moved
 * only documents.
 *
 * Refused when a target path is already taken, rather than merging the two
 * folders silently. Merging is a thing somebody might want; doing it by
 * accident, as the result of a typo in a rename, is not.
 */
export function planFolderRename(params: {
  from: string;
  to: string;
  /** Every path in the binder, documents and furniture alike. */
  paths: readonly string[];
  existingFolders: readonly string[];
}): ShapeChangeResult {
  const from = normalizeFolder(params.from);
  const to = normalizeFolder(params.to);

  if (from === "") return { error: "Name the folder to rename." };
  if (to === "") {
    return { error: "A folder needs a name with letters or numbers in it." };
  }
  if (from === to) {
    return { error: "That is the name it already has." };
  }
  if (!params.existingFolders.includes(from)) {
    return { error: `This binder has no folder called “${from}”.` };
  }

  // Moving a folder inside itself would put every file under a path that is
  // about to stop existing. Git would take it; nobody meant it.
  if (to === from || to.startsWith(`${from}/`)) {
    return { error: "A folder cannot be moved inside itself." };
  }

  const inside = params.paths.filter((path) => path.startsWith(`${from}/`));
  if (inside.length === 0) {
    return { error: `This binder has no folder called “${from}”.` };
  }

  const moving = new Set(inside);
  const takenPaths = new Set(params.paths);
  // **Two collisions, not one.** An identical path is the obvious one, and it
  // only catches furniture: two policies of the same name have different
  // identity segments, so their filenames differ and their *addresses* do not.
  // A rename that put both at `clinical/hand-hygiene` would leave a link
  // resolving to whichever came first, which is the failure "two documents
  // cannot claim one address" exists to prevent — found by a test against a
  // real Gitea after the path check alone let it through.
  const takenAddresses = new Set(
    params.paths
      .filter((path) => !moving.has(path))
      .map(addressOf)
      .filter((address): address is string => address !== null),
  );

  const operations: BinderFileOperation[] = [];

  for (const path of inside) {
    const relative = path.slice(from.length + 1);
    const moved = `${to}/${relative}`;

    if (takenPaths.has(moved)) {
      return {
        error: `“${to}” already holds something called “${relative}”. Renaming would write over it.`,
      };
    }

    const address = addressOf(moved);
    if (address !== null && takenAddresses.has(address)) {
      return {
        error: `“${to}” already holds a policy that would answer to “${address}”. Two documents cannot share one address.`,
      };
    }

    operations.push({ kind: "move", from: path, to: moved });
  }

  return {
    operations,
    title: `Rename ${from} to ${to}`,
    message: `Rename the folder ${from} to ${to}`,
  };
}

/**
 * The address a path answers to — its folder and name, with the identity
 * segment and the extension dropped.
 *
 * Through the same parser the tree listing uses, so "what address is this?" has
 * one answer in the product rather than one here and one there. Furniture has
 * no address to collide with.
 */
function addressOf(path: string): string | null {
  if (path.split("/").some((segment) => segment.startsWith("."))) return null;

  const lastSlash = path.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const { name } = parseDocumentFilename(path.slice(lastSlash + 1));

  return folder === "" ? name : `${folder}/${name}`;
}
