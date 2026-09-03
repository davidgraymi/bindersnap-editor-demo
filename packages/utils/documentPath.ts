/**
 * Where a document lives inside a binder, and what its versions are called.
 *
 * ADR 0004's third and fourth levels: a folder is a directory, a document is a
 * file inside it. So a document's identity is its path in the workspace
 * repository — `infection-control.pdf`, or `clinical/infection-control.pdf`
 * once somebody makes a folder — and not, as before, a repository of its own.
 *
 * Shared between the API, which commits to the path, and the app, which shows
 * a person where their document will live before they commit to it. Two copies
 * of this rule would drift, and the drift would surface as a document the
 * preview promised at one address and the server put at another.
 */

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

/**
 * `clinical/infection-control.pdf` — where the file goes.
 *
 * The extension rides on the path rather than on a canonical `document.<ext>`
 * inside a per-document directory. One repository held one document before, so
 * a fixed filename identified it; now the path does, and a second name under it
 * would only be something else to keep in sync.
 */
export function buildDocumentFilePath(
  name: string,
  extension: string,
  folder: string | null = null,
): string {
  const slugPath = buildDocumentSlugPath(name, folder);
  if (slugPath === "") return "";

  const normalized = extension.replace(/^\.+/, "").trim().toLowerCase();
  return normalized === "" ? slugPath : `${slugPath}.${normalized}`;
}

/**
 * `clinical/infection-control/v4` — the tag that publishes a version.
 *
 * Tags are repository-global and a binder holds many documents, so the version
 * has to carry the document with it. Publishing one change that touched three
 * documents writes three of these onto the same commit, which is ordinary git
 * and is what makes "who approved v4" answerable as tag → commit → pull
 * request → reviews.
 */
export function buildDocumentVersionTag(
  slugPath: string,
  version: number,
): string {
  return `${slugPath}/v${version}`;
}

/** The document a version tag belongs to, or null if it is not one of ours. */
export function documentSlugPathFromVersionTag(tag: string): string | null {
  const match = tag.match(/^(.+)\/v(\d+)$/);
  return match ? match[1]! : null;
}

/** The version a tag names, or null if it is not one of ours. */
export function versionFromTag(tag: string): number | null {
  const match = tag.match(/^(.+)\/v(\d+)$/);
  return match ? Number(match[2]) : null;
}
