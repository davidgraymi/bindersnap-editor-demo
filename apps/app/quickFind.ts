import type { WorkspaceRepo } from "./api";
import { capitalizeFirst, formatDocumentName } from "./documentDisplay";
import { formatWhen } from "./homeChanges";

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
  /** "alice/vendor-agreement" — stable across pages, so it dedupes. */
  key: string;
  owner: string;
  repo: string;
  /** "Vendor Agreement". */
  name: string;
  /** "Alice owns · updated 2h ago". */
  meta: string;
}

/** How many results one page holds. Two lands of them fill the panel. */
export const QUICK_FIND_PAGE_SIZE = 8;

/** Wait this long after the last keystroke before asking the server. */
export const QUICK_FIND_DEBOUNCE_MS = 180;

/** A query shorter than this is not yet a question worth asking. */
export const QUICK_FIND_MIN_QUERY = 2;

function normalizeLogin(login: string): string {
  return login.trim().replace(/^@/, "").toLowerCase();
}

/** The one line under a result's name: whose it is, and when it last moved. */
function describeResult(
  repo: WorkspaceRepo,
  currentUsername: string,
  now: number,
): string {
  const owner = repo.owner.login;
  const ownership =
    normalizeLogin(owner) === normalizeLogin(currentUsername)
      ? "You own"
      : `${capitalizeFirst(owner)} owns`;
  return `${ownership} · updated ${formatWhen(repo.updated_at, now)}`;
}

/** One repo, as a row. */
export function buildQuickFindResult(
  repo: WorkspaceRepo,
  currentUsername: string,
  now: number = Date.now(),
): QuickFindResult {
  return {
    key: `${repo.owner.login}/${repo.name}`,
    owner: repo.owner.login,
    repo: repo.name,
    name: formatDocumentName(repo.name),
    meta: describeResult(repo, currentUsername, now),
  };
}

export function buildQuickFindResults(
  repos: WorkspaceRepo[],
  currentUsername: string,
  now: number = Date.now(),
): QuickFindResult[] {
  return repos.map((repo) => buildQuickFindResult(repo, currentUsername, now));
}

/**
 * Add a page to what is already on screen.
 *
 * Gitea pages a live index: a document that moves between two requests can
 * come back on both pages, and a row that appeared twice would be a row the
 * arrow keys visit twice. The first copy wins, because that is the one the
 * reader has already looked at.
 */
export function appendQuickFindPage(
  existing: QuickFindResult[],
  incoming: QuickFindResult[],
): QuickFindResult[] {
  const seen = new Set(existing.map((result) => result.key));
  const added = incoming.filter((result) => {
    if (seen.has(result.key)) return false;
    seen.add(result.key);
    return true;
  });
  return added.length === 0 ? existing : [...existing, ...added];
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

/**
 * Whether a scroll has reached far enough to ask for the next page.
 *
 * Measured against the bottom rather than the last row so the fetch starts
 * roughly a row early — the results are then usually there by the time the
 * reader arrives at them.
 */
export function shouldLoadNextQuickFindPage(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 48,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

/** A query the server should actually be asked about. */
export function isQuickFindQuery(query: string): boolean {
  return query.trim().length >= QUICK_FIND_MIN_QUERY;
}

/** What the panel says when it has nothing to list. */
export function describeQuickFindEmptyState(query: string): string {
  return `No documents match “${query.trim()}”`;
}
