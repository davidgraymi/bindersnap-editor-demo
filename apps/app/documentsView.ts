import type { WorkspaceDocumentSummary } from "./api";
import {
  capitalizeFirst,
  formatDocumentName,
  hasEnoughApprovals,
} from "./documentDisplay";
import type { DocumentSearchParams } from "./documentSearch";
import { parseDocumentSearchQuery } from "./documentSearch";
import { formatDecisionDate, formatWhen } from "./homeChanges";

/**
 * The library page, decided here so the component only renders.
 *
 * Documents is the one screen that answers "what is in here?", and the shape
 * of that answer is a scope ("mine", "everyone's") narrowed by people. Both
 * live in the URL so a view can be linked and reloaded, and both are read back
 * out of it here — including the `owner:@me` query syntax the page used to put
 * in its placeholder, which still works for anyone who learned it.
 */

/** The three saved scopes, as chips across the top of the list. */
export type SavedView = "contributing" | "owned" | "everything";

export interface DocumentsViewState {
  view: SavedView;
  /** Owners the list is narrowed to. Empty means every owner in the scope. */
  people: string[];
  /** Plain words typed into the search box, if any. */
  freeText: string;
}

const VIEW_LABELS: Record<SavedView, string> = {
  contributing: "I contribute to",
  owned: "I own",
  everything: "Everything I can see",
};

export const SAVED_VIEWS: SavedView[] = ["contributing", "owned", "everything"];

export function getSavedViewLabel(view: SavedView): string {
  return VIEW_LABELS[view];
}

function isSavedView(value: string): value is SavedView {
  return (SAVED_VIEWS as string[]).includes(value);
}

function normalizeLogin(login: string): string {
  return login.trim().replace(/^@/, "").toLowerCase();
}

function uniqueLogins(logins: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const login of logins) {
    const normalized = normalizeLogin(login);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/**
 * Read the page's state out of a query string.
 *
 * The `q` parameter carries two things at once: plain words, and the
 * `owner:@someone` / `contributed-by:@someone` filters. A filter naming the
 * reader picks the matching chip; a filter naming anyone else becomes a person
 * chip, which is the same thing said in a way people can undo by clicking.
 */
export function parseDocumentsViewState(
  search: string,
  currentUsername: string,
): DocumentsViewState {
  const params = new URLSearchParams(search);
  const me = normalizeLogin(currentUsername);

  const rawQuery = params.get("q") ?? "";
  const parsed = parseDocumentSearchQuery(rawQuery, currentUsername);

  const viewParam = params.get("view") ?? "";
  let view: SavedView = isSavedView(viewParam) ? viewParam : "contributing";
  const people: string[] = [];

  if (parsed.ownerUsername) {
    const owner = normalizeLogin(parsed.ownerUsername);
    if (owner === me) {
      view = "owned";
    } else {
      // A filter on someone else says nothing about the reader's own scope, so
      // widen to everything they can see and let the chip do the narrowing.
      if (!isSavedView(viewParam)) view = "everything";
      people.push(owner);
    }
  }

  if (parsed.memberUsername) {
    const member = normalizeLogin(parsed.memberUsername);
    if (member === me) {
      view = "contributing";
    } else if (!isSavedView(viewParam)) {
      view = "everything";
    }
  }

  people.push(...(params.get("person") ?? "").split(",").filter(Boolean));

  return {
    view,
    people: uniqueLogins(people),
    freeText: (parsed.freeText ?? "").trim(),
  };
}

/** The address for a state. The default view has the plainest URL there is. */
export function buildDocumentsUrl(state: DocumentsViewState): string {
  const params = new URLSearchParams();

  if (state.view !== "contributing") params.set("view", state.view);
  if (state.people.length > 0) params.set("person", state.people.join(","));
  if (state.freeText) params.set("q", state.freeText);

  const query = params.toString();
  return query ? `/documents?${query}` : "/documents";
}

/**
 * What to ask the server for.
 *
 * Only the scope is a server concern: Gitea's repo search takes one user id,
 * so a person filter on top of a scope cannot be expressed in the same call.
 * The scope is the wider of the two, so it is the one that travels.
 */
export function toSearchParams(
  state: DocumentsViewState,
  currentUsername: string,
): DocumentSearchParams | undefined {
  const freeText = state.freeText || undefined;

  switch (state.view) {
    case "owned":
      return { ownerUsername: currentUsername, freeText };
    case "contributing":
      return { memberUsername: currentUsername, freeText };
    default:
      return freeText ? { freeText } : undefined;
  }
}

/** Narrow a fetched list to the people the reader picked. */
export function applyPersonFilter(
  documents: WorkspaceDocumentSummary[],
  people: string[],
): WorkspaceDocumentSummary[] {
  if (people.length === 0) return documents;
  const wanted = new Set(people.map(normalizeLogin));
  return documents.filter((document) =>
    wanted.has(normalizeLogin(document.repo.owner.login)),
  );
}

/** Every owner present in a list, for the "filter by person" picker. */
export function collectOwners(documents: WorkspaceDocumentSummary[]): string[] {
  return uniqueLogins(
    documents.map((document) => document.repo.owner.login),
  ).sort();
}

/** What the pill on a row says. The vocabulary is fixed by the design spec. */
export type DocumentRowStatus =
  "needs_your_review" | "ready_to_publish" | "in_review" | "current" | "draft";

const STATUS_LABELS: Record<DocumentRowStatus, string> = {
  needs_your_review: "Needs your review",
  ready_to_publish: "Ready to publish",
  in_review: "In review",
  current: "Current",
  draft: "Draft",
};

export function getDocumentRowStatusLabel(status: DocumentRowStatus): string {
  return STATUS_LABELS[status];
}

export interface DocumentRow {
  key: string;
  owner: string;
  repo: string;
  /** "Vendor Agreement". */
  name: string;
  /** "Jack owns · v3 · 2 open changes · updated 2h ago". */
  meta: string;
  status: DocumentRowStatus;
  statusLabel: string;
  /** The row is the reader's next action, and is allowed to wear coral. */
  urgent: boolean;
  updatedAt: number;
}

type OpenChange = WorkspaceDocumentSummary["pendingPRs"][number];

function isReady(change: OpenChange): boolean {
  return !change.isRejected && hasEnoughApprovals(change);
}

/** A stale approval is a review still owed: the version under it moved on. */
function awaits(change: OpenChange, username: string): boolean {
  return change.reviewers.some(
    (reviewer) =>
      normalizeLogin(reviewer.login) === normalizeLogin(username) &&
      (reviewer.status === "awaiting" || reviewer.stale),
  );
}

/**
 * The one word for where a document stands, worst news first.
 *
 * "Needs your review" outranks everything because it is the only status that
 * is about the reader; below it, work that can be finished outranks work that
 * cannot, and both outrank a document with nothing open.
 */
export function resolveDocumentRowStatus(
  document: WorkspaceDocumentSummary,
  username: string,
): DocumentRowStatus {
  const open = document.pendingPRs;

  if (
    open.some(
      (change) =>
        normalizeLogin(change.user?.login ?? "") !== normalizeLogin(username) &&
        awaits(change, username),
    )
  ) {
    return "needs_your_review";
  }

  if (open.some(isReady)) return "ready_to_publish";
  if (open.length > 0) return "in_review";
  return document.latestTag ? "current" : "draft";
}

function describeOwner(ownerLogin: string, username: string): string {
  return normalizeLogin(ownerLogin) === normalizeLogin(username)
    ? "You own"
    : `${capitalizeFirst(ownerLogin)} owns`;
}

function describeVersion(document: WorkspaceDocumentSummary): string {
  const version = document.latestTag?.version;
  return version === undefined ? "no version published yet" : `v${version}`;
}

/**
 * The change clause: how much is in flight, in the fewest words that say it.
 *
 * A single change is described rather than counted — "1 open change" and
 * "your v4 proposal in review" are the same fact, and only one of them tells
 * the reader whose move it is.
 */
function describeOpenChanges(
  document: WorkspaceDocumentSummary,
  username: string,
): string {
  const open = document.pendingPRs;
  if (open.length === 0) return "no open changes";

  if (open.length === 1) {
    const change = open[0]!;
    if (isReady(change)) return "1 open change, ready to publish";
    if (normalizeLogin(change.user?.login ?? "") === normalizeLogin(username)) {
      return `your v${(document.latestTag?.version ?? 0) + 1} proposal in review`;
    }
    return "1 open change";
  }

  const ready = open.filter(isReady).length;
  return ready > 0
    ? `${open.length} open changes, ${ready} ready to publish`
    : `${open.length} open changes`;
}

/**
 * The last clause: the most recent thing that actually happened.
 *
 * A document with nothing open is best described by its approval — that is
 * the date a reader cares about — while anything in flight is described by
 * when it last moved.
 */
function describeRecency(
  document: WorkspaceDocumentSummary,
  now: number,
): string {
  if (document.pendingPRs.length === 0 && document.latestTag) {
    const approved = formatDecisionDate(document.latestTag.created);
    if (approved) return `approved ${approved}`;
  }
  return `updated ${formatWhen(document.repo.updated_at, now)}`;
}

function toTime(timestamp: string): number {
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** One document, as a row: a name, one sentence, and one pill. */
export function buildDocumentRow(
  document: WorkspaceDocumentSummary,
  username: string,
  now: number = Date.now(),
): DocumentRow {
  const owner = document.repo.owner.login;
  const status = resolveDocumentRowStatus(document, username);

  return {
    key: `${owner}/${document.repo.name}`,
    owner,
    repo: document.repo.name,
    name: formatDocumentName(document.repo.name),
    meta: [
      describeOwner(owner, username),
      describeVersion(document),
      describeOpenChanges(document, username),
      describeRecency(document, now),
    ].join(" · "),
    status,
    statusLabel: STATUS_LABELS[status],
    urgent: status === "needs_your_review",
    updatedAt: toTime(document.repo.updated_at),
  };
}

/** Every row, last moved first — the only order the page offers. */
export function buildDocumentRows(
  documents: WorkspaceDocumentSummary[],
  username: string,
  now: number = Date.now(),
): DocumentRow[] {
  return documents
    .map((document) => buildDocumentRow(document, username, now))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

const COUNT_SUFFIXES: Record<SavedView, string> = {
  contributing: "you contribute to",
  owned: "you own",
  everything: "you can see",
};

/**
 * The line under the list. It names the scope, because "6 documents" on a
 * filtered page is a number without a question.
 */
export function describeDocumentCount(
  view: SavedView,
  shown: number,
  total: number,
): string {
  const noun = total === 1 ? "document" : "documents";
  const scope = `${noun} ${COUNT_SUFFIXES[view]}`;
  return shown === total
    ? `${total} ${scope}`
    : `${shown} of ${total} ${scope}`;
}

/** "Owned by Jack" — the label on a person chip. */
export function describePersonChip(login: string): string {
  return capitalizeFirst(login);
}
