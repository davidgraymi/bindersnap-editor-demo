import { CircleCheck, CircleSlash, FilePen, Undo2 } from "lucide-react";

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
  /**
   * The version an open change becomes when published — a fact only a list
   * about one document can state. Omitted by a binder's list, where a change
   * can touch three documents that do not advance in lockstep.
   */
  nextVersion?: number;
  /**
   * What the change is about, when the list cannot say it in a version
   * number: "Hand Hygiene", or "Hand Hygiene v2" once it has published one.
   */
  describeSubject?: (changeNumber: number) => string | null;
  onFilterChange: (filter: ChangeFilter) => void;
  onOpenChange: (pullNumber: number) => void;
  onRetryClosed: () => void;
}

/**
 * The icon carries the outcome, so the list reads before it is read.
 *
 * Not git glyphs. A branch-fork and a merge-arrow are precise to anyone who
 * has used GitHub and unreadable to everyone else, and the reader here is a
 * compliance manager. A document-with-a-pen for a change somebody is still
 * proposing, and a tick for one that is published, say the same thing without
 * the vocabulary lesson.
 */
function ChangeIcon({ change }: { change: ChangeRecord }) {
  const props = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

  if (change.outcome === "published") {
    return (
      <CircleCheck
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
    <FilePen className="change-row-icon change-row-icon--open" {...props} />
  );
}

function ChangeRow({
  change,
  nextVersion,
  describeSubject,
  onOpenChange,
}: {
  change: ChangeRecord;
  nextVersion?: number;
  describeSubject?: (changeNumber: number) => string | null;
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
  const subject = describeSubject?.(change.number) ?? null;

  return (
    <li className="change-row">
      <button
        className="bs-row bs-row--tall change-row-btn"
        type="button"
        onClick={() => onOpenChange(change.number)}
      >
        <span className="bs-row-icon">
          <ChangeIcon change={change} />
        </span>
        <span className="bs-row-body">
          <span className="bs-row-name change-row-title">{change.summary}</span>
          {/* No "#8". The number is Gitea's pull-request id — a GitHub habit
              that means nothing to a compliance manager and reads like it
              ought to. What identifies a change to the person reading the row
              is its title, who sent it and when, all of which are here. The
              number still addresses the change in the URL. */}
          <span className="bs-row-meta">
            Submitted by {submitter}
            {submitted ? ` on ${submitted}` : ""}
            {subject
              ? ` · ${subject}`
              : change.open && nextVersion !== undefined
                ? ` · becomes v${nextVersion} when published`
                : ""}
          </span>
          {outcome ? <span className="bs-row-meta">{outcome}</span> : null}
        </span>
        <span className="bs-row-right change-row-side">
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
  describeSubject,
  onFilterChange,
  onOpenChange,
  onRetryClosed,
}: DocumentChangesProps) {
  const rows = filter === "open" ? openChanges : (closedChanges ?? []);

  return (
    <section className="bs-panel" aria-label="Changes">
      {/* The filter is the list's own, so it lives in the list's bar rather
          than floating on the page above it. */}
      <div className="bs-panel-bar">
        <div className="bs-segmented" role="group" aria-label="Filter changes">
          <button
            className="bs-seg"
            type="button"
            aria-pressed={filter === "open"}
            onClick={() => onFilterChange("open")}
          >
            Open {openChanges.length}
          </button>
          <button
            className="bs-seg"
            type="button"
            aria-pressed={filter === "closed"}
            onClick={() => onFilterChange("closed")}
          >
            Closed{closedChanges === null ? "" : ` ${closedChanges.length}`}
          </button>
        </div>
      </div>

      {filter === "closed" && closedError ? (
        <div className="bs-empty">
          <p className="bs-empty-lead">Unable to load closed changes</p>
          <p>{closedError}</p>
          <button
            className="bs-btn bs-btn--sm bs-btn-secondary"
            type="button"
            onClick={onRetryClosed}
          >
            Retry
          </button>
        </div>
      ) : filter === "closed" && closedLoading ? (
        <SkeletonGroup label="Loading closed changes">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="bs-row bs-row--tall" key={index}>
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
        <div className="bs-empty">
          {filter === "open" ? (
            <>
              {/* Wording the integration suite waits on: this heading is how
                  the app says "nothing is pending". */}
              <h2 className="bs-empty-lead">No pending approvals</h2>
              <p>
                Nothing is waiting on a decision. Every version has been
                published or withdrawn.
              </p>
            </>
          ) : (
            <>
              <h2 className="bs-empty-lead">No closed changes</h2>
              <p>Nothing has been published, declined, or withdrawn yet.</p>
            </>
          )}
        </div>
      ) : (
        <ul className="bs-row-list">
          {rows.map((change) => (
            <ChangeRow
              key={change.number}
              change={change}
              nextVersion={nextVersion}
              describeSubject={describeSubject}
              onOpenChange={onOpenChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
