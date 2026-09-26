import { useEffect, useState } from "react";
import { Columns2, GitBranch } from "lucide-react";

import { fetchBinderChanges } from "../api";
import type { WorkspaceChangeSummary } from "../../../packages/api-schema/schemas/workspaces";
import { followInApp } from "../appLink";
import { describeBranch } from "../branchLabel";
import { formatAge, formatTimestamp } from "../documentDisplay";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { SkeletonLine } from "./Skeleton";

/**
 * What this branch is, where the binder's last change sits on the record.
 *
 * **The same slot, a different fact.** On the record, the card above the tree
 * says what was published last. On a branch that would be a fact about the
 * wrong ref — so it says which branch this is and what is being asked of it:
 * the change request it belongs to, who opened it and when, and the way to
 * what it changes. That, the tinted picker and the card's own tint are what
 * make "this is not the published binder" impossible to miss without a
 * button that pretends the reader came from somewhere.
 */

interface BinderBranchSummaryProps {
  org: string;
  binder: string;
  branch: string;
  /** Where a change is, and its comparison, so both are real links. */
  changeHref: (changeNumber: number, compare?: boolean) => string;
  onOpenChange: (changeNumber: number, compare?: boolean) => void;
}

export function BinderBranchSummary({
  org,
  binder,
  branch,
  changeHref,
  onOpenChange,
}: BinderBranchSummaryProps) {
  const names = usePeopleNames(org);
  const nameOf = (login: string) => nameFor(names, login);
  // Undefined while loading; null once it is known no change sits on it.
  const [change, setChange] = useState<
    WorkspaceChangeSummary | null | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    setChange(undefined);

    // Open first — it is nearly always one — and then the decided ones, for a
    // branch reached from a change that has since been published.
    const find = async () => {
      for (const state of ["open", "closed"] as const) {
        const payload = await fetchBinderChanges(org, binder, state);
        const found = payload.changes.find(
          (entry) => entry.branchName === branch,
        );
        if (found) return found;
      }
      return null;
    };

    find()
      .then((found) => {
        if (!cancelled) setChange(found);
      })
      .catch(() => {
        if (!cancelled) setChange(null);
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder, branch]);

  const name = describeBranch(branch, nameOf);

  if (change === undefined) {
    return (
      <section
        className="bs-panel binder-latest binder-latest--branch binder-latest--loading"
        aria-busy="true"
        aria-label="This branch"
      >
        <SkeletonLine width="medium" />
      </section>
    );
  }

  const count = change?.documents.length ?? 0;

  return (
    <section
      className="bs-panel binder-latest binder-latest--branch"
      aria-label="This branch"
    >
      <span className="binder-latest-icon" aria-hidden="true">
        <GitBranch size={16} strokeWidth={1.75} />
      </span>
      <div className="binder-latest-body">
        {change ? (
          <a
            className="binder-latest-title"
            href={changeHref(change.number)}
            onClick={(event) =>
              followInApp(event, () => onOpenChange(change.number))
            }
          >
            {change.title}
          </a>
        ) : (
          <span className="binder-latest-title">{name}</span>
        )}
        <p className="binder-latest-meta">
          {change ? (
            <>
              {name} · change {change.number} ·{" "}
              {change.closedAt
                ? "decided"
                : `opened by ${nameOf(change.submittedBy)}`}{" "}
              <time
                dateTime={change.closedAt ?? change.submittedAt}
                title={formatTimestamp(change.closedAt ?? change.submittedAt)}
              >
                {formatAge(change.closedAt ?? change.submittedAt)}
              </time>
            </>
          ) : (
            "Not proposed — nothing here is published or up for review."
          )}
        </p>
      </div>
      {change ? (
        <div className="binder-latest-right">
          <span className="binder-latest-count">
            {count === 1 ? "1 document" : `${count} documents`}
          </span>
          <a
            className="bs-btn bs-btn--sm bs-btn-secondary binder-latest-history"
            href={changeHref(change.number, true)}
            onClick={(event) =>
              followInApp(event, () => onOpenChange(change.number, true))
            }
          >
            <Columns2 size={14} strokeWidth={1.75} aria-hidden="true" />
            Changes
          </a>
        </div>
      ) : null}
    </section>
  );
}
