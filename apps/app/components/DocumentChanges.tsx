import type { ChangeRecord } from "../documentDisplay";
import { ChangeRow } from "./ChangeRow";
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
 * One change in the list.
 *
 * **It used to say far too much.** The row carried the title, who submitted it
 * and when, what it would become — "becomes v4 when published", which a binder
 * cannot promise because one change can touch three documents — and a pill
 * holding an approval count *and* a sentence naming who was holding it up. The
 * customer's words: *"That is WAYYY too much text."*
 *
 * It is `ChangeRow` now, the same component Home and the review queue use, so
 * a change reads the same wherever it is listed and the three cannot drift
 * apart again.
 */
function BinderChangeRow({
  change,
  onOpenChange,
}: {
  change: ChangeRecord;
  onOpenChange: (pullNumber: number) => void;
}) {
  return (
    <ChangeRow
      change={{
        number: change.number,
        title: change.summary,
        submittedBy: change.submittedBy,
        submittedAt: change.submittedAt,
        updatedAt: change.updatedAt,
        commentCount: change.commentCount,
        outcome: change.outcome,
        approvalCount: change.approvalCount,
        requiredApprovals: change.requiredApprovals,
        isRejected: change.isRejected,
      }}
      onOpen={() => onOpenChange(change.number)}
    />
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
            <BinderChangeRow
              key={change.number}
              change={change}
              onOpenChange={onOpenChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
