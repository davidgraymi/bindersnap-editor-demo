/**
 * Which part of a binder the address bar is pointing at.
 *
 * A binder is laid out the way a repository is, so its tabs live in the URL
 * the way a repository's do — a person sends a colleague "the change requests
 * on Clinical Policies", not "Clinical Policies, then click the second tab".
 *
 * In the query rather than the path because the path is already the binder's
 * contents: `/{org}/{binder}/changes` cannot be told apart from a policy filed
 * at `changes`, and neither can `history` or `settings`. The document page
 * reads `?version=` and the change page `?change=` for the same reason.
 */

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

/** The tab the query asks for, or Documents when it asks for nothing valid. */
export function binderTabFromSearch(search: string): BinderTab {
  const raw = new URLSearchParams(search).get("tab");
  return BINDER_TABS.find((tab) => tab === raw) ?? "documents";
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
 * `/{org}/{binder}`, `?tab=changes`, or `?tab=changes&change=3`.
 *
 * Documents carries no `tab` at all: the binder's own address should be the
 * short one, the way a repository's is.
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
}): string {
  const { org, binder, tab = "documents", change, view, edit = "off" } = params;
  const query = new URLSearchParams();

  if (tab !== "documents") query.set("tab", tab);
  // Not editing is the ordinary state, so it says nothing — the binder's own
  // address stays the short one.
  if (edit === "editing") query.set("edit", "1");
  if (edit === "proposing") query.set("edit", "propose");
  if (change !== undefined) query.set("change", String(change));
  // The discussion is where a decision is made, so it is the screen a bare
  // change link opens and the one that needs no name.
  if (view !== undefined && view !== "discussion") query.set("view", view);

  const search = query.toString();
  return search === "" ? `/${org}/${binder}` : `/${org}/${binder}?${search}`;
}

/**
 * Which screen of a change the address bar is asking for.
 *
 * The discussion is where the decision is made, so it is what a bare change
 * link opens; the proposed file and the comparison each get their own address
 * so a reviewer can send "look at the diff" rather than "open it and click".
 */
export function changeViewFromSearch(search: string): DocumentChangeView {
  const raw = new URLSearchParams(search).get("view");
  return raw === "preview" || raw === "compare" ? raw : "discussion";
}
