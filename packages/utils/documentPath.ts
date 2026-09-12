/**
 * Where a document lives inside a binder, what it is called, and which document
 * it is.
 *
 * ADR 0004's third and fourth levels: a folder is a directory, a document is a
 * file inside it. **ADR 0005 amends that in one place** — the document's
 * *identity* is no longer its path. A filename carries three things:
 *
 * ```
 * nursing / hand-hygiene . 01J8XZ4K7MQ9V3B0RN7YHS2E1D . md
 *  folder      name              identity                ext
 * ```
 *
 * The name may be changed and the folder may be changed; the identity segment
 * never is, so a retitled policy keeps its version numbering instead of
 * silently restarting at v1 and orphaning every tag it had.
 *
 * **Parsing is unambiguous** because {@link slugifyDocumentName} reduces a title
 * to lower-case alphanumerics and dashes: the human half can never contain a
 * dot. So the identity is the last dot-separated segment that satisfies
 * `isDocumentUid`, whatever else the filename holds, and a file with no
 * extension parses by the same rule.
 *
 * Shared between the API, which commits to the path, and the app, which shows
 * a person where their document will live before they commit to it. Two copies
 * of this rule would drift, and the drift would surface as a document the
 * preview promised at one address and the server put at another. Note the
 * division of labour: the app builds the *address* it promises (name, folder,
 * extension) and the server builds the *filename*, because only the server
 * mints an identity.
 */

import { isDocumentUid } from "./documentUid";

/** Long enough for a real policy title, short enough to stay a usable path. */
export const MAX_DOCUMENT_SLUG_LENGTH = 80;

/** How deep folders may nest. Deep enough for any filing scheme, bounded. */
export const MAX_FOLDER_DEPTH = 8;

/**
 * Reduce a title to a path segment: lowercase alphanumerics and dashes.
 *
 * Stricter than the organization rule, which tolerates dots and underscores.
 * A dot in a path segment invites confusion with the extension, and the
 * extension is what tells us how to render the document.
 */
export function slugifyDocumentName(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_DOCUMENT_SLUG_LENGTH)
    .replace(/-+$/, "");
}

/**
 * Normalize a folder into repository-relative directory segments.
 *
 * Everything that could escape the workspace is dropped rather than rejected:
 * `..`, absolute paths, and empty segments from doubled slashes. A path that
 * climbs out of the repository is not a folder a person meant to type, and
 * committing to one would write outside the binder that governs it.
 */
export function normalizeFolderSegments(folder: string | null): string[] {
  if (!folder) return [];

  return folder
    .split("/")
    .map((segment) => slugifyDocumentName(segment))
    .filter((segment) => segment !== "")
    .slice(0, MAX_FOLDER_DEPTH);
}

/** `clinical/infection-control` — the document without its extension. */
export function buildDocumentSlugPath(
  name: string,
  folder: string | null = null,
): string {
  const slug = slugifyDocumentName(name);
  if (slug === "") return "";

  return [...normalizeFolderSegments(folder), slug].join("/");
}

/** An extension as it is written on disk: no leading dots, lower case. */
function normalizeExtension(extension: string): string {
  return extension.replace(/^\.+/, "").trim().toLowerCase();
}

/**
 * `clinical/infection-control.pdf` — the address, as a person would write it.
 *
 * What the app shows before an upload, and deliberately **not** what is
 * committed: the identity segment is minted server-side and is not the app's to
 * invent. Showing it here would also put a 26-character blob in front of
 * somebody who is being asked to confirm where their policy is going.
 */
export function buildDocumentDisplayPath(
  name: string,
  extension: string,
  folder: string | null = null,
): string {
  const slugPath = buildDocumentSlugPath(name, folder);
  if (slugPath === "") return "";

  const normalized = normalizeExtension(extension);
  return normalized === "" ? slugPath : `${slugPath}.${normalized}`;
}

/**
 * `clinical/infection-control.01J8XZ4K7M….pdf` — where the file actually goes.
 *
 * The identity sits between the name and the extension rather than at the front
 * of the filename, so a directory listing still sorts and reads by what the
 * documents are called. The extension stays last because it is what tells every
 * reader — ours, git's, an operating system's — how to render the file.
 */
export function buildDocumentFilePath(
  name: string,
  extension: string,
  uid: string,
  folder: string | null = null,
): string {
  const slugPath = buildDocumentSlugPath(name, folder);
  if (slugPath === "") return "";

  const normalized = normalizeExtension(extension);
  return normalized === ""
    ? `${slugPath}.${uid}`
    : `${slugPath}.${uid}.${normalized}`;
}

/** A filename pulled apart into the three things it carries. */
export interface ParsedDocumentFilename {
  /** `hand-hygiene` — what the document is called. */
  name: string;
  /** The identity, or null for a file this product did not write. */
  uid: string | null;
  /** `md`, or "" for a file with no extension. */
  extension: string;
}

/**
 * Read a filename back into its parts.
 *
 * Tolerant by design, because it is run over every blob in a binder's tree and
 * a file it does not recognise is a file to describe, not to throw over: a
 * filename with no identity segment parses with `uid: null` and keeps its name.
 * The publish guard is where that becomes a refusal, once — refusing here would
 * mean a binder holding one stray file could not be listed at all.
 *
 * Takes the filename, not the path: the folder is the caller's business and a
 * folder is allowed to contain dots.
 */
export function parseDocumentFilename(
  filename: string,
): ParsedDocumentFilename {
  const parts = filename.split(".");

  // The *last* matching segment, so a document somebody managed to call
  // `01J8XZ4K7MQ9V3B0RN7YHS2E1D` still gets the identity that was minted for it
  // rather than the one it is named after.
  for (let at = parts.length - 1; at >= 1; at -= 1) {
    if (!isDocumentUid(parts[at]!)) continue;

    return {
      name: parts.slice(0, at).join("."),
      uid: parts[at]!,
      extension: parts.slice(at + 1).join("."),
    };
  }

  // No identity. The name is everything up to a final extension, and a leading
  // dot is part of the name — `.gitignore` is not an extension with no name.
  const lastDot = filename.lastIndexOf(".");
  return lastDot <= 0
    ? { name: filename, uid: null, extension: "" }
    : {
        name: filename.slice(0, lastDot),
        uid: null,
        extension: filename.slice(lastDot + 1),
      };
}

/**
 * `01J8XZ4K7MQ9V3B0RN7YHS2E1D/v4` — the tag that publishes a version.
 *
 * Tags are repository-global and a binder holds many documents, so the version
 * has to carry the document with it. Publishing one change that touched three
 * documents writes three of these onto the same commit, which is ordinary git
 * and is what makes "who approved v4" answerable as tag → commit → pull
 * request → reviews.
 *
 * **Keyed on the identity, not the path** (ADR 0005), which is what makes a
 * rename survivable. It costs the legibility of `git tag -l`, and that is paid
 * back in the tag message: the stamp names the title and the path as they stood
 * at the publish, so `git tag -n1` still reads as English.
 *
 * **The tag is also the counter, and that is a feature.** Two changes
 * publishing one document at once both compute v4 and both try to create this
 * ref; git refuses the second, atomically and for free.
 */
export function buildDocumentVersionTag(uid: string, version: number): string {
  return `${uid}/v${version}`;
}

/**
 * The document a version tag belongs to, or null if it is not one of ours.
 *
 * Validated rather than pattern-matched: a repository may carry tags nobody
 * here wrote, and counting one of those as a version would put a number on a
 * document that never had it.
 */
export function documentUidFromVersionTag(tag: string): string | null {
  const match = tag.match(/^([^/]+)\/v(\d+)$/);
  if (!match) return null;

  const uid = match[1]!;
  return isDocumentUid(uid) ? uid : null;
}

/** The version a tag names, or null if it is not one of ours. */
export function versionFromTag(tag: string): number | null {
  const match = tag.match(/^([^/]+)\/v(\d+)$/);
  if (!match || !isDocumentUid(match[1]!)) return null;
  return Number(match[2]);
}
