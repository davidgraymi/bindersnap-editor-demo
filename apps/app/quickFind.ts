import type { LibraryDocument } from "./api";
import { formatDocumentName } from "./documentDisplay";

/**
 * Quick find, decided here so the panel only renders.
 *
 * The nav search used to be a form: type, press Enter, land on the library,
 * read the list. That is three steps to reach a document whose name the
 * reader already knew. Quick find answers while they type — the panel is a
 * list of things, and picking one goes straight there.
 *
 * **Three kinds, not one.** It searched documents only, which made it a
 * shortcut rather than a way to get anywhere: the fastest route to a binder
 * was still to remember which organization owned it, and the fastest route to
 * a person was to open a binder they happened to be in. A command palette that
 * reaches one kind of thing is a filter with a keyboard shortcut. Documents
 * still come first, because that is what people look for most.
 *
 * Results arrive a page at a time and are appended, so the panel can show the
 * first few immediately and fetch the rest only if the reader scrolls past
 * them. Nothing here talks to the network; the component owns that.
 */

/** What a row points at. Decides its icon, its group and where Enter goes. */
export type QuickFindKind = "document" | "binder" | "person";

/** One row in the panel, and the one line that identifies it. */
export interface QuickFindResult {
  /** Unique across kinds — dedupes pages, and keys the list. */
  key: string;
  kind: QuickFindKind;
  organization: string;
  /** "Infection Control Policy", "Clinical", "Bob Okafor". */
  name: string;
  /**
   * "Clinical · nursing · v3", "4 policies", "Editor in Clinical".
   *
   * **The binder, not the owner.** A document used to be a repository somebody
   * owned, so the line that identified it said whose it was. Under ADR 0004 the
   * organization owns everything and nobody owns a document — the question a
   * reader is actually disambiguating with is *which binder*, and after that
   * which folder.
   */
  meta: string;
  /** Set on a document and a binder; the binder it is in, or that it is. */
  binder?: string;
  /** The document's identity inside the binder, which is its address. */
  slugPath?: string;
  /** Set on a person. */
  username?: string;
}

/** How many results one page holds. Two lands of them fill the panel. */
export const QUICK_FIND_PAGE_SIZE = 8;

/** Wait this long after the last keystroke before asking the server. */
export const QUICK_FIND_DEBOUNCE_MS = 180;

/** A query shorter than this is not yet a question worth asking. */
export const QUICK_FIND_MIN_QUERY = 2;

/** "Clinical · nursing · v3", or as much of it as is known. */
function describeResult(document: LibraryDocument): string {
  // The binder as a person writes it, not the repository slug — the same name
  // its own page and the sidebar show.
  const parts = [formatDocumentName(document.binder)];
  if (document.folder) parts.push(document.folder);
  if (document.latestVersion) parts.push(`v${document.latestVersion.version}`);
  else parts.push("no published version");
  return parts.join(" · ");
}

/** One document, as a row. */
export function buildQuickFindResult(
  document: LibraryDocument,
): QuickFindResult {
  return {
    key: `document:${document.organization}/${document.binder}/${document.slugPath}`,
    kind: "document",
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

/** One binder, as a row. */
export function buildBinderResult(
  organization: string,
  binder: { name: string; description?: string },
): QuickFindResult {
  return {
    key: `binder:${organization}/${binder.name}`,
    kind: "binder",
    organization,
    binder: binder.name,
    name: formatDocumentName(binder.name),
    // Its own description when it has one. A binder people wrote a sentence
    // about is told apart by that sentence, not by a count.
    meta: binder.description?.trim() || "Binder",
  };
}

/** One person, as a row. */
export function buildPersonResult(
  organization: string,
  person: { username: string; fullName?: string; role?: string },
): QuickFindResult {
  const name = person.fullName?.trim() || person.username;
  return {
    key: `person:${organization}/${person.username}`,
    kind: "person",
    organization,
    username: person.username,
    name,
    // The username is the disambiguator when two people share a name, so it is
    // always on the line even when the display name is what is shown.
    meta: person.role?.trim()
      ? `${person.role} · ${person.username}`
      : person.username,
  };
}

/**
 * Everything matching, documents first.
 *
 * The order is the answer to "what did you most likely mean". Documents are
 * what this was built for and what people look for most; a binder or a person
 * is the rarer thing you reach for when the document is not what you wanted.
 * Within a kind the server's order is kept.
 */
const KIND_ORDER: Record<QuickFindKind, number> = {
  document: 0,
  binder: 1,
  person: 2,
};

export function orderQuickFindResults(
  results: QuickFindResult[],
): QuickFindResult[] {
  return [...results].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Does this row match what was typed? Binders and people are filtered here. */
export function matchesQuickFindQuery(
  haystack: string,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return false;
  return haystack.toLowerCase().includes(needle);
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
  return `Nothing matches “${query.trim()}”`;
}

/** The heading above each run of rows. Absent when a kind has none. */
export const QUICK_FIND_GROUP_LABELS: Record<QuickFindKind, string> = {
  document: "Policies",
  binder: "Binders",
  person: "People",
};
