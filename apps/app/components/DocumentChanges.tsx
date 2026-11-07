import { formatDocumentName, type ChangeRecord } from "../documentDisplay";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { splitDecidedChanges } from "../changeRow";
import { ChangeRow } from "./ChangeRow";
import { SkeletonGroup, SkeletonLine, SkeletonShape } from "./Skeleton";

/**
 * Which changes the list shows. `published` and `closed` are both read from
 * the decided changes: published went on the record, closed did not.
 */
export type ChangeFilter = "open" | "published" | "closed";

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
  onOpenChange: (pullNumber: number, binder?: string) => void;
  /** The address of one change, so each row is a link. */
  changeHref: (pullNumber: number, binder?: string) => string;
  onRetryClosed: () => void;
  /** Whose people these are, so a row names its author, not their login. */
  org: string;
  /**
   * The binder a change is in, when the list spans several — an
   * organization's. Rows are then told apart by binder as well as number,
   * each leads its meta line with its binder, and `changeHref` and
   * `onOpenChange` are told which binder it is.
   */
  binderOf?: (change: ChangeRecord) => string | null;
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
  authorName,
  href,
  context,
  onOpen,
}: {
  change: ChangeRecord;
  authorName: string;
  href: string;
  context: string | null;
  onOpen: () => void;
}) {
  return (
    <ChangeRow
      change={{
        number: change.number,
        title: change.summary,
        submittedBy: change.submittedBy,
        submittedByName: authorName,
        submittedAt: change.submittedAt,
        updatedAt: change.updatedAt,
        commentCount: change.commentCount,
        outcome: change.outcome,
        approvalCount: change.approvalCount,
        requiredApprovals: change.requiredApprovals,
        isRejected: change.isRejected,
      }}
      href={href}
      context={context}
      onOpen={onOpen}
    />
  );
}

/**
 * The index of every change this document has ever seen.
 *
 * Open changes are the work; decided ones are the record, split the way a
 * surveyor asks about them: what was published, and what was closed without
 * being published. Why a change was closed is said on its row, not guessed
 * into a status word.
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
  changeHref,
  onRetryClosed,
  org,
  binderOf,
}: DocumentChangesProps) {
  const { published, closed } = splitDecidedChanges(closedChanges);
  const rows =
    filter === "open"
      ? openChanges
      : filter === "published"
        ? (published ?? [])
        : (closed ?? []);
  const decidedFilter = filter !== "open";
  const names = usePeopleNames(org);

  return (
    <section className="bs-panel" aria-label="Changes">
      {/* The filter is the list's own, so it lives in the list's bar rather
          than floating on the page above it. */}
      <div className="bs-panel-bar">
        <div className="bs-segmented" role="group" aria-label="Filter changes">
          <button
            className="bs-seg queue-counter"
            type="button"
            aria-pressed={filter === "open"}
            onClick={() => onFilterChange("open")}
          >
            Open
            <span className="queue-counter-value">{openChanges.length}</span>
          </button>
          <button
            className="bs-seg queue-counter"
            type="button"
            aria-pressed={filter === "published"}
            onClick={() => onFilterChange("published")}
          >
            Published
            {published === null ? null : (
              <span className="queue-counter-value">{published.length}</span>
            )}
          </button>
          <button
            className="bs-seg queue-counter"
            type="button"
            aria-pressed={filter === "closed"}
            onClick={() => onFilterChange("closed")}
          >
            Closed
            {closed === null ? null : (
              <span className="queue-counter-value">{closed.length}</span>
            )}
          </button>
        </div>
      </div>

      {decidedFilter && closedError ? (
        <div className="bs-empty">
          <p className="bs-empty-lead">Unable to load decided changes</p>
          <p>{closedError}</p>
          <button
            className="bs-btn bs-btn--sm bs-btn-secondary"
            type="button"
            onClick={onRetryClosed}
          >
            Retry
          </button>
        </div>
      ) : decidedFilter && closedLoading ? (
        <SkeletonGroup label="Loading decided changes">
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
                published or closed.
              </p>
            </>
          ) : filter === "published" ? (
            <>
              <h2 className="bs-empty-lead">Nothing published yet</h2>
              <p>A change appears here once it is approved and published.</p>
            </>
          ) : (
            <>
              <h2 className="bs-empty-lead">No closed changes</h2>
              <p>
                A change closed without being published appears here. It can be
                reopened.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="bs-row-list">
          {rows.map((change) => {
            const binder = binderOf?.(change) ?? undefined;
            return (
              <BinderChangeRow
                key={binder ? `${binder}#${change.number}` : change.number}
                change={change}
                authorName={nameFor(names, change.submittedBy)}
                href={changeHref(change.number, binder)}
                context={binder ? formatDocumentName(binder) : null}
                onOpen={() => onOpenChange(change.number, binder)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
