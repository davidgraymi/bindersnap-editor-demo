import type { DocumentSearchHit } from "./api";
import { formatDocumentName } from "./documentDisplay";
import type { QuickFindAction } from "./quickFindActions";

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
export type QuickFindKind =
  "action" | "document" | "change" | "binder" | "organization" | "person";

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
  /** Set on a change request: its number in its binder. */
  changeNumber?: number;
  /** Set on one of Bindersnap's own pages or controls: what picking it does. */
  action?: QuickFindAction;
  /**
   * Set on a document found by its words: the passage that matched, the
   * matched words marked. Plain text, never markup.
   */
  excerpt?: { text: string; match: boolean }[];
}

/** How many results one page holds. Two lands of them fill the panel. */
export const QUICK_FIND_PAGE_SIZE = 8;

/** Wait this long after the last keystroke before asking the server. */
export const QUICK_FIND_DEBOUNCE_MS = 180;

/** A query shorter than this is not yet a question worth asking. */
export const QUICK_FIND_MIN_QUERY = 2;

/** "Clinical · Nursing / Wards": which binder, then which folder. */
function describeResult(document: DocumentSearchHit): string {
  // The binder and the folder as a person writes them, not as the address
  // does — "Nursing / Wards", the way the document's own page says its path.
  const parts = [formatDocumentName(document.binder)];
  if (document.folder) {
    parts.push(
      document.folder
        .split("/")
        .filter(Boolean)
        .map(formatDocumentName)
        .join(" / "),
    );
  }
  return parts.join(" · ");
}

/**
 * One document, as a row.
 *
 * A document found by its words carries the passage that matched, so the
 * reader can tell which of five policies that mention "sharps" is the one
 * about disposal before they open any of them.
 */
export function buildQuickFindResult(
  document: DocumentSearchHit,
): QuickFindResult {
  return {
    key: `document:${document.organization}/${document.binder}/${document.slugPath}`,
    kind: "document",
    organization: document.organization,
    binder: document.binder,
    slugPath: document.slugPath,
    name: formatDocumentName(document.name),
    meta: describeResult(document),
    ...(document.snippet && document.snippet.parts.length > 0
      ? { excerpt: document.snippet.parts }
      : {}),
  };
}

export function buildQuickFindResults(
  documents: DocumentSearchHit[],
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

/** One change request, as a row: where it is, its number, how it stands. */
export function buildChangeResult(change: {
  org: string;
  binder: string;
  number: number;
  title: string;
  state: "open" | "published" | "closed";
  author: string;
}): QuickFindResult {
  const standing =
    change.state === "open"
      ? "Open"
      : change.state === "published"
        ? "Published"
        : "Closed";
  return {
    key: `change:${change.org}/${change.binder}#${change.number}`,
    kind: "change",
    organization: change.org,
    binder: change.binder,
    changeNumber: change.number,
    name: change.title || `Change ${change.number}`,
    meta: [
      formatDocumentName(change.binder),
      `#${change.number}`,
      standing,
      change.author,
    ]
      .filter((part) => part !== "")
      .join(" · "),
  };
}

/**
 * One of Bindersnap's own pages or controls, as a row.
 *
 * It belongs to no organization, so `organization` is empty; where it goes is
 * in the action itself.
 */
export function buildActionResult(action: QuickFindAction): QuickFindResult {
  return {
    key: `action:${action.id}`,
    kind: "action",
    organization: "",
    name: action.name,
    meta: action.meta,
    action,
  };
}

/** One organization, as a row. */
export function buildOrganizationResult(organization: {
  name: string;
  displayName: string;
}): QuickFindResult {
  return {
    key: `organization:${organization.name}`,
    kind: "organization",
    organization: organization.name,
    name: organization.displayName || organization.name,
    meta: "Organization",
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
 * Everything matching: Bindersnap's own pages first, then documents.
 *
 * The order is the answer to "what did you most likely mean". A page or a
 * control only matches when a word of its name was typed — "help", "billing",
 * "dark" — and somebody who typed one is asking for that, not for every
 * document that mentions it. After those, documents are what this was built
 * for and what people look for most; a binder or a person is the rarer thing
 * you reach for when the document is not what you wanted. Within a kind the
 * order it arrived in is kept.
 */
const KIND_ORDER: Record<QuickFindKind, number> = {
  action: 0,
  document: 1,
  change: 2,
  binder: 3,
  organization: 4,
  person: 5,
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
  action: "Pages and actions",
  document: "Documents",
  change: "Change requests",
  binder: "Binders",
  organization: "Organizations",
  person: "People",
};
