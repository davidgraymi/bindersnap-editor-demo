import type { LibraryDocument } from "./api";
import { formatDocumentName } from "./documentDisplay";

/**
 * Quick find, decided here so the panel only renders.
 *
 * The nav search used to be a form: type, press Enter, land on the library,
 * read the list. That is three steps to reach a document whose name the
 * reader already knew. Quick find answers while they type — the panel is a
 * list of documents, and picking one goes straight there.
 *
 * Results arrive a page at a time and are appended, so the panel can show the
 * first few immediately and fetch the rest only if the reader scrolls past
 * them. Nothing here talks to the network; the component owns that, and hands
 * each page to `appendQuickFindPage`.
 */

/** One row in the panel: a document, and the one line that identifies it. */
export interface QuickFindResult {
  /** "riverside-health/clinical/nursing/infection-control" — dedupes pages. */
  key: string;
  organization: string;
  binder: string;
  /** The document's identity inside the binder, which is its address. */
  slugPath: string;
  /** "Infection Control Policy", formatted from the stored slug. */
  name: string;
  /**
   * "Clinical · nursing · v3".
   *
   * **The binder, not the owner.** A document used to be a repository somebody
   * owned, so the line that identified it said whose it was. Under ADR 0004 the
   * organization owns everything and nobody owns a document — the question a
   * reader is actually disambiguating with is *which binder*, and after that
   * which folder.
   */
  meta: string;
}

/** How many results one page holds. Two lands of them fill the panel. */
export const QUICK_FIND_PAGE_SIZE = 8;

/** Wait this long after the last keystroke before asking the server. */
export const QUICK_FIND_DEBOUNCE_MS = 180;

/** A query shorter than this is not yet a question worth asking. */
export const QUICK_FIND_MIN_QUERY = 2;

/** "Clinical · nursing · v3", or as much of it as is known. */
function describeResult(document: LibraryDocument): string {
  const parts = [document.binder];
  if (document.folder) parts.push(document.folder);
  if (document.latestVersion) parts.push(`v${document.latestVersion.version}`);
  else if (document.state === "proposed") parts.push("not published yet");
  return parts.join(" · ");
}

/** One document, as a row. */
export function buildQuickFindResult(
  document: LibraryDocument,
): QuickFindResult {
  return {
    key: `${document.organization}/${document.binder}/${document.slugPath}`,
    organization: document.organization,
    binder: document.binder,
    slugPath: document.slugPath,
    name: formatDocumentName(document.name),
    meta: describeResult(document),
  };
}

export function buildQuickFindResults(
  documents: LibraryDocument[],
): QuickFindResult[] {
  return documents.map(buildQuickFindResult);
}

/**
 * Where the arrow keys go next.
 *
 * The list wraps, and -1 is "nothing highlighted" — the state the panel opens
 * in, where Enter means "search the library for this" rather than "open the
 * document I did not pick". Down from there highlights the first result; up
 * from there highlights the last, which is how a reader reaches the bottom of
 * a short list in one key.
 */
export function moveQuickFindHighlight(
  current: number,
  delta: number,
  count: number,
): number {
  if (count === 0) return -1;
  if (current === -1) return delta > 0 ? 0 : count - 1;

  const next = current + delta;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}

/** A query the server should actually be asked about. */
export function isQuickFindQuery(query: string): boolean {
  return query.trim().length >= QUICK_FIND_MIN_QUERY;
}

/** What the panel says when it has nothing to list. */
export function describeQuickFindEmptyState(query: string): string {
  return `No documents match “${query.trim()}”`;
}
