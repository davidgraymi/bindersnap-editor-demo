/**
 * Which part of a binder the address bar is pointing at.
 *
 * **GitLab's addresses, for a binder.** Everything that is the binder's own
 * screen sits behind a `/-/` segment — `/{org}/{binder}/-/changes/4`,
 * `/-/history`, `/-/settings` — and a file sits at the branch it is read on,
 * `/-/blob/main/nursing/hand-hygiene`. The `-` is a name Gitea refuses for a
 * repository, an organization and a folder alike, so nothing a customer names
 * can collide with a screen of ours: a policy filed at `changes` and the
 * Change requests tab used to be the same address, which is why every screen
 * lived in the query.
 *
 * A ref is one path segment, encoded — `upload%2Fnursing%2F…` — because a
 * branch name has slashes in it and so does the file after it, and the client
 * has no list of branches to tell them apart the way GitLab's server does.
 */

import { parsePositiveIntParam } from "./binderDocument";
import type { DocumentChangeView } from "./routes";

/** The tabs a binder has. Documents is the one it opens on. */
export const BINDER_TABS = [
  "documents",
  "changes",
  "people",
  "sign-off",
  "history",
  "settings",
] as const;
export type BinderTab = (typeof BINDER_TABS)[number];

/** The branch a binder is read on when the address names none. */
export const DEFAULT_REF = "main";

/** Everything the address says about which screen of a binder is on show. */
export interface BinderAddress {
  tab: BinderTab;
  /** The change request open, or the one a branch was reached from. */
  change: number | null;
  view: DocumentChangeView;
  /** The branch the documents are read on. Null is the record. */
  ref: string | null;
  /** A file in the binder, when the address is one. */
  documentPath: string | null;
  /** The archive — what this binder has taken off the record. */
  archive: boolean;
}

const HOME: BinderAddress = {
  tab: "documents",
  change: null,
  view: "discussion",
  ref: null,
  documentPath: null,
  archive: false,
};

function decodeRef(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Read what follows `/{org}/{binder}`: nothing, or a `/-/` screen.
 *
 * `rest` is that remainder with its leading slash, and null when it is not
 * one of ours — an older `/{org}/{binder}/{path}` address, which the app
 * rewrites before anything reads it. `?change=` beside a branch is where the
 * reader came from; it is the one screen fact still in the query.
 */
export function parseBinderAddress(
  rest: string,
  search = "",
): BinderAddress | null {
  const path = rest.replace(/\/+$/, "");
  if (path === "") return HOME;
  if (!path.startsWith("/-/")) return null;

  const [screen = "", ...parts] = path.slice(3).split("/");
  const cameFrom = parsePositiveIntParam(search, "change");

  switch (screen) {
    case "tree":
      return parts[0]
        ? { ...HOME, ref: decodeRef(parts[0]), change: cameFrom }
        : HOME;
    case "blob": {
      const [ref, ...file] = parts;
      if (!ref || file.length === 0) return HOME;
      return {
        ...HOME,
        ref: decodeRef(ref),
        documentPath: file.join("/"),
        change: cameFrom,
      };
    }
    case "changes": {
      const number = Number(parts[0]);
      if (!Number.isInteger(number) || number <= 0) {
        return { ...HOME, tab: "changes" };
      }
      const view: DocumentChangeView =
        parts[1] === "diffs"
          ? "compare"
          : parts[1] === "preview"
            ? "preview"
            : "discussion";
      return { ...HOME, tab: "changes", change: number, view };
    }
    case "history":
      return { ...HOME, tab: "history" };
    case "settings":
      return {
        ...HOME,
        tab:
          parts[0] === "people"
            ? "people"
            : parts[0] === "sign-off"
              ? "sign-off"
              : "settings",
      };
    case "archive":
      return { ...HOME, archive: true };
    default:
      return HOME;
  }
}

/** The address a binder screen is on right now, from the window. */
export function currentBinderAddress(): BinderAddress {
  const match = window.location.pathname.match(/^\/[^/]+\/[^/]+(\/.*)?$/);
  return parseBinderAddress(match?.[1] ?? "", window.location.search) ?? HOME;
}

/**
 * The same facts from an address written before `/-/`: `?tab=changes&
 * change=4&view=compare`, `?ref=`, `?archive=1`. Only the rewrite reads it.
 */
export function parseLegacyBinderQuery(search: string): BinderAddress {
  const params = new URLSearchParams(search);
  const raw = params.get("tab");
  const view = params.get("view");
  const ref = params.get("ref")?.trim() ?? "";
  return {
    tab: BINDER_TABS.find((tab) => tab === raw) ?? "documents",
    change: parsePositiveIntParam(search, "change"),
    view: view === "preview" || view === "compare" ? view : "discussion",
    ref: ref === "" ? null : ref,
    documentPath: null,
    archive: params.get("archive") === "1",
  };
}

/**
 * Whether the binder is being edited, and which screen of editing.
 *
 * **In the address rather than in a component's memory**, for the reason every
 * other state in this file is: a reload should not throw the work away. Edit
 * mode is a draft on the server, so it survives a refresh whatever the page
 * remembers — putting it in the URL is what lets the page find its way back to
 * it, and lets somebody keep a tab open on the binder they are rearranging.
 *
 * Proposing is a value of the same key rather than a second one, because "am I
 * editing" has one answer: the propose screen is reached from edit mode, is
 * left back into it, and cannot be true while `edit` is not.
 */
export type BinderEditMode = "off" | "editing" | "proposing";

export function editModeFromSearch(search: string): BinderEditMode {
  const raw = new URLSearchParams(search).get("edit");
  if (raw === "propose") return "proposing";
  return raw === "1" ? "editing" : "off";
}

/**
 * Which of your drafts the address is asking for, if it names one.
 *
 * Null for "whichever is newest" — a bare `?edit=1` from before drafts were
 * plural, or a person with one draft, which is most of them. Never trusted:
 * the server checks the branch is yours and is still a draft before anything
 * is read at it, and falls back to the newest when it is not.
 */
export function draftFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("draft")?.trim() ?? "";
  return raw === "" ? null : raw;
}

/**
 * `/{org}/{binder}`, `/-/changes`, `/-/changes/3`, `/-/changes/3/diffs`.
 *
 * The documents on the record carry nothing at all: the binder's own address
 * should be the short one, the way a repository's is.
 */
export function buildBinderUrl(params: {
  org: string;
  binder: string;
  tab?: BinderTab;
  change?: number;
  /** Which screen of that change: its discussion, the file, or the compare. */
  view?: DocumentChangeView;
  /** Editing the binder's contents, or writing up the draft to propose it. */
  edit?: BinderEditMode;
  /**
   * Which of your drafts you are editing in.
   *
   * A person may have several (D8), so the address has to say which — a
   * reload, a back button or a pasted link all have to land in the same work.
   * Unsaid means the newest, which is what it meant when there could only be
   * one.
   */
  draft?: string | null;
  /** The archive — what this binder has taken off the record. */
  archive?: boolean;
  /**
   * Read the binder's documents at a branch rather than on `main`.
   *
   * With `change` beside it and no `tab`, this is the binder as that change
   * would leave it — where a change's branch link goes. The change says which
   * one to ask the server for and gives the reader the way back.
   */
  ref?: string | null;
}): string {
  const {
    org,
    binder,
    tab = "documents",
    change,
    view,
    edit = "off",
    draft = null,
    archive = false,
    ref = null,
  } = params;
  const base = `/${org}/${binder}`;
  const query = new URLSearchParams();
  let path: string;

  if (archive) {
    path = "/-/archive";
  } else if (tab === "changes") {
    path =
      change === undefined
        ? "/-/changes"
        : `/-/changes/${change}${
            view === "compare" ? "/diffs" : view === "preview" ? "/preview" : ""
          }`;
  } else if (tab === "history") {
    path = "/-/history";
  } else if (tab === "settings") {
    path = "/-/settings";
  } else if (tab === "people" || tab === "sign-off") {
    path = `/-/settings/${tab}`;
  } else {
    path = ref ? `/-/tree/${encodeURIComponent(ref)}` : "";
    // Where a branch was reached from, so the reader keeps the way back.
    if (ref && change !== undefined) query.set("change", String(change));
    // Not editing is the ordinary state, so it says nothing — the binder's
    // own address stays the short one.
    if (edit === "editing") query.set("edit", "1");
    if (edit === "proposing") query.set("edit", "propose");
    // Only while editing: a draft named on an address that is not an edit is
    // a claim about a state the page is not in.
    if (edit !== "off" && draft) query.set("draft", draft);
  }

  const search = query.toString();
  return search === "" ? `${base}${path}` : `${base}${path}?${search}`;
}
