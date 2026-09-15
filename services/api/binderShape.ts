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
 * **A renamed document keeps every version it had**, which is the whole reason
 * ADR 0005 came first. A document's identity is a segment of its filename and
 * moves with the file, so a policy that lands at a new path is the same policy
 * on its next version rather than a new one starting at v1 with every tag it
 * had orphaned behind it. Renaming could not be shipped before that.
 */

import {
  buildDocumentFilePath,
  normalizeFolderSegments,
  parseDocumentFilename,
  slugifyDocumentName,
} from "../../packages/utils/documentPath";
import { formatDocumentName } from "../../packages/utils/documentTitle";

import type { WorkspaceDocumentEntry } from "./gitea-client/workspaceDocuments";

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
    title: `Add the folder ${describeFolder(folder)}`,
    message: `Add the folder ${describeFolder(folder)}`,
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

  // Titled, for the same reason a document rename is: this sentence is read by
  // the people being asked to approve it, and `infection-control` is the
  // storage format rather than anything anybody typed.
  const said =
    parentOf(from) === parentOf(to)
      ? `Rename the folder ${describeFolder(from)} to ${describeFolder(to)}`
      : `Move the folder ${describeFolder(from)} to ${describeFolder(to)}`;

  return { operations, title: said, message: said };
}

/** `clinical/nursing` → `clinical`; a top-level folder has no parent. */
function parentOf(folder: string): string {
  const cut = folder.lastIndexOf("/");
  return cut === -1 ? "" : folder.slice(0, cut);
}

/**
 * Rename a document, file it somewhere else, or both.
 *
 * **The act ADR 0005 was written for.** The identity segment moves with the
 * file, so the version tags still match and the policy carries on from the
 * version it was on — which under ADR 0004 would have restarted at v1 and
 * orphaned everything published before it.
 *
 * Name and folder together, because they are one question — where does this
 * live and what is it called — and splitting them would make a common act two
 * change requests.
 */
export function planDocumentRename(params: {
  document: WorkspaceDocumentEntry;
  /** The new title, or undefined to keep the one it has. */
  name?: string;
  /** The new folder, or undefined to keep the one it is in. "" is the root. */
  folder?: string;
  /** Every path in the binder, so a collision is caught before it is written. */
  paths: readonly string[];
}): ShapeChangeResult {
  const { document } = params;

  if (document.uid === null) {
    return {
      error: `“${document.path}” was not added through Bindersnap, so renaming it would lose its history.`,
    };
  }

  const name = params.name === undefined ? document.name : params.name;
  const slug = slugifyDocumentName(name);
  if (slug === "") {
    return {
      error: "That name has no letters or numbers to make a path from.",
    };
  }

  const folder =
    params.folder === undefined
      ? document.folder
      : normalizeFolder(params.folder);

  const extension = parseDocumentFilename(
    document.path.slice(document.path.lastIndexOf("/") + 1),
  ).extension;
  const to = buildDocumentFilePath(
    name,
    extension,
    document.uid,
    folder || null,
  );

  if (to === document.path) {
    return { error: "That is where it already is." };
  }

  // A URL has to name one thing. Two documents at one address resolve to
  // whichever came first, which is a link somebody sends being a coin toss.
  const address = folder === "" ? slug : `${folder}/${slug}`;
  const collision = params.paths.find(
    (path) => path !== document.path && addressOf(path) === address,
  );
  if (collision) {
    return {
      error: `“${address}” is already taken by “${collision}”. Two documents cannot share one address.`,
    };
  }

  // **Said the way the person who did it would say it.** These two strings
  // stopped being an internal detail the moment drafts existed: the commit
  // subject is what a draft reads back as, and it is what prefills the change
  // request an author sends to colleagues. `Move
  // nursing/hand-hygiene.01M2DJ….md to nursing/hand-hygiene-and-ppe.01M2DJ….md`
  // put a 26-character identity segment — a thing nobody typed and nobody can
  // act on — in front of the people being asked to approve a rename.
  const was = formatDocumentName(document.name);
  const now = formatDocumentName(slug);
  const renamed = slug !== document.name;
  const refiled = folder !== document.folder;
  const where =
    folder === "" ? "the binder’s top level" : describeFolder(folder);

  const said = renamed
    ? refiled
      ? `Rename ${was} to ${now} and move it to ${where}`
      : `Rename ${was} to ${now}`
    : `Move ${was} to ${where}`;

  return {
    operations: [{ kind: "move", from: document.path, to }],
    title: said,
    message: said,
  };
}

/** `clinical/infection-control` → `Clinical / Infection Control`. */
function describeFolder(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
}

/**
 * Take a document off the record.
 *
 * **"Archive", not "delete", and the word is the customer's:** *"delete should
 * be allowed, but I think it should be called archive because delete has
 * connotations."* They are right, and it is not only a kinder word — it is the
 * accurate one. The file leaves `main` and nothing else happens to it: every
 * version tag still points at the commit that held it, git never collects a
 * commit reachable from a ref, and the bytes stay readable from a bare clone
 * at every version the policy ever reached. Nothing is destroyed, which is
 * what "delete" would have promised and what ADR 0004 exists to prevent.
 *
 * So the whole act is one removal. The audit line — who, when, under which
 * change — is a `<uid>/archived-<n>` tag written at the publish that merges
 * this, in the same transaction as the version tags.
 *
 * **Refused for a file with no identity**, and not because of the tag. A file
 * this product did not write has no version tags at all, so removing it from
 * `main` really would be a delete: no ref would point at the commit holding
 * it, and the only trace would be in the history of a branch. That is the one
 * case where the word would be a lie, so it is not offered.
 */
export function planDocumentArchive(params: {
  document: WorkspaceDocumentEntry;
}): ShapeChangeResult {
  const { document } = params;

  if (document.uid === null) {
    return {
      error: `“${document.path}” was not added through Bindersnap, so it has no published versions to fall back on. Archiving it would be a deletion.`,
    };
  }

  const said = `Archive ${formatDocumentName(document.name)}`;

  return {
    operations: [{ kind: "remove", path: document.path }],
    title: said,
    message: said,
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
