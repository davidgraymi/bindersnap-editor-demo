import type { LibraryDocument } from "./api";
import { formatDocumentName } from "./documentDisplay";

/**
 * The library page, decided here so the component only renders.
 *
 * **This page lost most of its questions to ADR 0004, and that is the point.**
 * It used to offer saved views — "contributing", "owned", "everything" — and a
 * filter by person, because a document was a repository somebody owned and
 * those were real distinctions. Under ADR 0004 the organization owns the
 * binder and the binder holds the policy: nobody owns a document, and everyone
 * who can see a binder can see everything in it. Keeping the chips would have
 * meant inventing meanings for them.
 *
 * What is left is what the page is actually opened with — "where is that
 * policy" — narrowed by the one thing that does distinguish policies now:
 * which binder they are filed in. Both live in the URL, so a view can be
 * linked and reloaded.
 */

export interface DocumentsViewState {
  /** `org/binder`, or null for every binder the reader can reach. */
  binder: string | null;
  /** Plain words typed into the search box, if any. */
  freeText: string;
}

export function parseDocumentsViewState(search: string): DocumentsViewState {
  const params = new URLSearchParams(search);
  const binder = params.get("binder")?.trim() || null;
  return {
    binder,
    freeText: params.get("q")?.trim() ?? "",
  };
}

export function buildDocumentsUrl(state: DocumentsViewState): string {
  const params = new URLSearchParams();
  if (state.binder) params.set("binder", state.binder);
  if (state.freeText) params.set("q", state.freeText);
  const query = params.toString();
  return query === "" ? "/documents" : `/documents?${query}`;
}

/** `riverside-health/clinical` — how a binder is named in the URL. */
export function binderKey(document: {
  organization: string;
  binder: string;
}): string {
  return `${document.organization}/${document.binder}`;
}

/**
 * What a row says about where a policy stands.
 *
 * Every row is on `main` now — the library lists the record, the same rule the
 * binder follows — so "not published yet" is no longer a row that can appear
 * from a policy in flight. It survives for the other way of reaching it: a file
 * on the record that no change ever tagged.
 */
export type DocumentRowStatus = "published" | "in_review" | "unpublished";

export function getDocumentRowStatusLabel(status: DocumentRowStatus): string {
  if (status === "in_review") return "In review";
  return status === "published" ? "Published" : "No published version";
}

export interface DocumentRow {
  key: string;
  organization: string;
  binder: string;
  slugPath: string;
  name: string;
  /** `nursing`, or "" at the binder's root. */
  folder: string;
  status: DocumentRowStatus;
  /** "v3", or "" for a policy with no version on record. */
  version: string;
  openChangeCount: number;
}

export function buildDocumentRow(document: LibraryDocument): DocumentRow {
  // Changes in flight are what a reader is about to walk into, so they lead.
  // Otherwise: a tag on record, or a file on record that has none.
  const status: DocumentRowStatus =
    document.openChangeCount > 0
      ? "in_review"
      : document.latestVersion === null
        ? "unpublished"
        : "published";

  return {
    key: `${document.organization}/${document.binder}/${document.slugPath}`,
    organization: document.organization,
    binder: document.binder,
    slugPath: document.slugPath,
    name: formatDocumentName(document.name),
    folder: document.folder,
    status,
    version: document.latestVersion ? `v${document.latestVersion.version}` : "",
    openChangeCount: document.openChangeCount,
  };
}

export function buildDocumentRows(documents: LibraryDocument[]): DocumentRow[] {
  return documents.map(buildDocumentRow);
}

/** Narrow to one binder, or leave every binder in. */
export function applyBinderFilter(
  rows: DocumentRow[],
  binder: string | null,
): DocumentRow[] {
  if (!binder) return rows;
  return rows.filter((row) => binderKey(row) === binder);
}

/** "12 policies", "1 policy", "No policies". */
export function describeDocumentCount(count: number): string {
  if (count === 0) return "No policies";
  return count === 1 ? "1 policy" : `${count} policies`;
}
