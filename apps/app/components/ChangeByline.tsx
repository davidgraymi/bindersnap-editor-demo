import { GitBranch } from "lucide-react";
import type { ReactNode } from "react";

import { followInApp } from "../appLink";
import { describeBranch, type BranchNameOf } from "../branchLabel";
import { describePublishIntent } from "../changedDocuments";
import { formatShortDate } from "../documentDisplay";

interface ChangeBylineProps {
  /** The badge: open, or how it ended. */
  status?: ReactNode;
  /** Who proposed it, as a name. */
  author: string;
  open: boolean;
  /** How many documents it would version. Zero for a sign-off rules change. */
  documents: number;
  /** The branch it came from, or null when that is gone. */
  branch: string | null;
  branchHref: string;
  onOpenBranch: () => void;
  /** When it was opened. */
  openedAt: string;
  /** Names the logins inside a branch name: `draft/carol/…` is Carol's. */
  nameOf?: BranchNameOf;
}

/**
 * The line under a change's title: **who wants to publish what, from where,
 * and since when**.
 *
 * One component for both of a change's screens. Overview said "Carol Mendes
 * opened this on Sep 23, 2026 · becomes v2 when published" and Changes said
 * "carol wants to publish 1 document from upload/finance/expenses-policy/…" —
 * the same fact in two sentences, a login on one and a name on the other, and
 * a branch path where a person expects a name. GitLab puts one sentence there
 * and keeps it as you move between tabs; so does this.
 */
export function ChangeByline({
  status,
  author,
  open,
  documents,
  branch,
  branchHref,
  onOpenBranch,
  openedAt,
  nameOf,
}: ChangeBylineProps) {
  const intent =
    documents === 0
      ? open
        ? "wants to change the sign-off rules"
        : "proposed new sign-off rules"
      : describePublishIntent({ open, documents });
  const when = formatShortDate(openedAt);

  return (
    <p className="cmp-byline">
      {status}
      <span>
        <strong>{author || "Somebody"}</strong> {intent}
        {branch ? (
          <>
            {" from "}
            {/* The branch's root, not its first file — the whole binder as
                this change would leave it. */}
            <a
              className="cmp-branch"
              href={branchHref}
              title={branch}
              onClick={(event) => followInApp(event, onOpenBranch)}
            >
              <GitBranch size={12} strokeWidth={1.75} aria-hidden="true" />
              {describeBranch(branch, nameOf)}
            </a>
          </>
        ) : null}
        {when ? (
          <span className="bs-nowrap">
            {" · opened "}
            {when}
          </span>
        ) : null}
      </span>
    </p>
  );
}
