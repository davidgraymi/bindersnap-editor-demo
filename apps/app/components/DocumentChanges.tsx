import { CircleSlash, GitMerge, GitPullRequest, Undo2 } from "lucide-react";

import type { ChangeRecord } from "../documentDisplay";
import {
  capitalizeFirst,
  describeChangeOutcome,
  describeChangeStanding,
  formatShortDate,
  getChangeStateBadgeClass,
  getChangeStateLabel,
} from "../documentDisplay";
import { ApprovalMeter } from "./ApprovalMeter";
import { SkeletonGroup, SkeletonLine, SkeletonShape } from "./Skeleton";

export type ChangeFilter = "open" | "closed";

interface DocumentChangesProps {
  isAnonymous: boolean;
  filter: ChangeFilter;
  openChanges: ChangeRecord[];
  /** Null until the closed list has been asked for. */
  closedChanges: ChangeRecord[] | null;
  closedLoading: boolean;
  closedError: string | null;
  nextVersion: number;
  onFilterChange: (filter: ChangeFilter) => void;
  onOpenChange: (pullNumber: number) => void;
  onRetryClosed: () => void;
  onSubmitVersion: () => void;
}

/** The icon carries the outcome, so the list reads before it is read. */
function ChangeIcon({ change }: { change: ChangeRecord }) {
  const props = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

  if (change.outcome === "published") {
    return (
      <GitMerge
        className="change-row-icon change-row-icon--published"
        {...props}
      />
    );
  }
  if (change.outcome === "declined") {
    return (
      <CircleSlash
        className="change-row-icon change-row-icon--declined"
        {...props}
      />
    );
  }
  if (change.outcome === "withdrawn") {
    return (
      <Undo2
        className="change-row-icon change-row-icon--withdrawn"
        {...props}
      />
    );
  }
  return (
    <GitPullRequest
      className="change-row-icon change-row-icon--open"
      {...props}
    />
  );
}

function ChangeRow({
  change,
  nextVersion,
  onOpenChange,
}: {
  change: ChangeRecord;
  nextVersion: number;
  onOpenChange: (pullNumber: number) => void;
}) {
  const submitter = capitalizeFirst(change.submittedBy || "someone");
  const submitted = change.submittedAt
    ? formatShortDate(change.submittedAt)
    : null;
  const outcome = describeChangeOutcome(change);
  // The standing pill says where an open change stands and who it waits on, so
  // the badge is left with the one thing it does not cover: how a closed change
  // ended. The row's old "Waiting on …" line is inside the pill now.
  const showStateBadge = describeChangeStanding(change) === null;

  return (
    <li className="change-row" key={change.number}>
      <button
        className="change-row-btn"
        type="button"
        onClick={() => onOpenChange(change.number)}
      >
        <ChangeIcon change={change} />
        <span className="change-row-main">
          <span className="change-row-title">{change.summary}</span>
          <span className="change-row-meta">
            #{change.number} submitted by {submitter}
            {submitted ? ` on ${submitted}` : ""}
            {change.open ? ` · becomes v${nextVersion} when published` : ""}
          </span>
          {outcome ? (
            <span className="change-row-outcome">{outcome}</span>
          ) : null}
        </span>
        <span className="change-row-side">
          {showStateBadge ? (
            <span className={getChangeStateBadgeClass(change)}>
              {getChangeStateLabel(change)}
            </span>
          ) : (
            <ApprovalMeter change={change} />
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * The index of every change this document has ever seen.
 *
 * Open changes are the work; closed ones are the record, and the record has to
 * say what happened — a change that was declined and a change its author gave
 * up on are not the same event, and "closed" tells a reader neither.
 */
export function DocumentChanges({
  isAnonymous,
  filter,
  openChanges,
  closedChanges,
  closedLoading,
  closedError,
  nextVersion,
  onFilterChange,
  onOpenChange,
  onRetryClosed,
  onSubmitVersion,
}: DocumentChangesProps) {
  const rows = filter === "open" ? openChanges : (closedChanges ?? []);

  return (
    <section className="change-index" aria-label="Changes">
      <div className="change-index-bar">
        <div className="change-filter" role="group" aria-label="Filter changes">
          <button
            className={`change-filter-btn${filter === "open" ? " change-filter-btn--active" : ""}`}
            type="button"
            aria-pressed={filter === "open"}
            onClick={() => onFilterChange("open")}
          >
            <GitPullRequest size={14} strokeWidth={1.5} aria-hidden="true" />
            {openChanges.length} Open
          </button>
          <button
            className={`change-filter-btn${filter === "closed" ? " change-filter-btn--active" : ""}`}
            type="button"
            aria-pressed={filter === "closed"}
            onClick={() => onFilterChange("closed")}
          >
            <GitMerge size={14} strokeWidth={1.5} aria-hidden="true" />
            {closedChanges === null ? "" : `${closedChanges.length} `}Closed
          </button>
        </div>
      </div>

      {filter === "closed" && closedError ? (
        <div className="change-empty">
          <p className="change-empty-title">Unable to load closed changes</p>
          <p className="change-empty-note">{closedError}</p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onRetryClosed}
          >
            Retry
          </button>
        </div>
      ) : filter === "closed" && closedLoading ? (
        <SkeletonGroup
          label="Loading closed changes"
          className="change-list-rows"
        >
          {Array.from({ length: 3 }, (_, index) => (
            <div className="bs-skeleton-row" key={index}>
              <SkeletonShape variant="icon" />
              <span className="bs-skeleton-lines">
                <SkeletonLine width="wide" />
                <SkeletonLine width="medium" />
              </span>
              <SkeletonShape variant="badge" />
            </div>
          ))}
        </SkeletonGroup>
      ) : rows.length === 0 ? (
        <div className="change-empty">
          {filter === "open" ? (
            <>
              {/* Wording the integration suite waits on: this heading is how
                  the app says "nothing is pending". */}
              <h2 className="change-empty-title">No pending approvals</h2>
              <p className="change-empty-note">
                Nothing is waiting on a decision. Every version has been
                published or withdrawn.
              </p>
              {!isAnonymous ? (
                <button
                  className="bs-btn bs-btn-primary"
                  type="button"
                  onClick={onSubmitVersion}
                >
                  Submit New Version
                </button>
              ) : null}
            </>
          ) : (
            <>
              <h2 className="change-empty-title">No closed changes</h2>
              <p className="change-empty-note">
                Nothing has been published, declined, or withdrawn yet.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="change-list-rows">
          {rows.map((change) => (
            <ChangeRow
              key={change.number}
              change={change}
              nextVersion={nextVersion}
              onOpenChange={onOpenChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
