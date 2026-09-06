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

/** The tabs a binder has. Documents is the one it opens on. */
export const BINDER_TABS = ["documents", "changes"] as const;
export type BinderTab = (typeof BINDER_TABS)[number];

/** The tab the query asks for, or Documents when it asks for nothing valid. */
export function binderTabFromSearch(search: string): BinderTab {
  const raw = new URLSearchParams(search).get("tab");
  return BINDER_TABS.find((tab) => tab === raw) ?? "documents";
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
}): string {
  const { org, binder, tab = "documents", change } = params;
  const query = new URLSearchParams();

  if (tab !== "documents") query.set("tab", tab);
  if (change !== undefined) query.set("change", String(change));

  const search = query.toString();
  return search === "" ? `/${org}/${binder}` : `/${org}/${binder}?${search}`;
}
