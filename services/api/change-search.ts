/**
 * Change requests found by what they are called, for quick find.
 *
 * Gitea's own issue search, across every repository the reader can see, kept
 * to pull requests in the reader's organizations — a repository anywhere else
 * is not a binder — and said the way the product says a change's state.
 *
 * Pure. The Gitea calls happen in the request handler.
 */

import type { components } from "./gitea-client/spec/gitea";

type Issue = components["schemas"]["Issue"];

export interface FoundChange {
  org: string;
  binder: string;
  number: number;
  title: string;
  state: "open" | "published" | "closed";
  /** Who opened it. */
  author: string;
  updatedAt: string;
}

export function toFoundChanges(
  issues: readonly Issue[],
  organizations: ReadonlySet<string>,
  limit: number,
): FoundChange[] {
  const found: FoundChange[] = [];
  for (const issue of issues) {
    const org = issue.repository?.owner ?? "";
    const binder = issue.repository?.name ?? "";
    if (!org || !binder || !organizations.has(org)) continue;
    if (!issue.pull_request || !issue.number) continue;
    found.push({
      org,
      binder,
      number: issue.number,
      title: issue.title ?? "",
      state:
        issue.state === "open"
          ? "open"
          : issue.pull_request.merged
            ? "published"
            : "closed",
      author: issue.user?.full_name?.trim() || issue.user?.login || "",
      updatedAt: issue.updated_at ?? "",
    });
    if (found.length === limit) break;
  }
  return found;
}
