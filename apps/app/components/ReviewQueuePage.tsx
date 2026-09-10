import { useCallback, useEffect, useMemo, useState } from "react";

import { getHomeChanges, type HomeOpenDocument } from "../api";
import {
  buildQueueRows,
  countQueueRows,
  describeQueue,
  filterQueueRows,
  initialQueueFilter,
  QUEUE_FILTERS,
  QUEUE_FILTER_LABELS,
  type QueueFilter,
  type QueueRow,
} from "../reviewQueue";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Every change in flight, across every binder.
 *
 * The screen the product was missing. Home is a to-do list — it shows what is
 * waiting on you and drops the rest — and a binder's Change requests tab shows
 * one binder. Neither answers "what is going on", which is the question
 * somebody with four binders opens the app with.
 *
 * The counters are the filters. They are not decoration: each one is the
 * number of rows you get by pressing it, which is asserted in
 * reviewQueue.test.ts so the two can never drift.
 */

interface ReviewQueuePageProps {
  currentUsername: string;
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  onBrowseDocuments: () => void;
}

export function ReviewQueuePage({
  currentUsername,
  onOpenChange,
  onBrowseDocuments,
}: ReviewQueuePageProps) {
  const [documents, setDocuments] = useState<HomeOpenDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until the rows land, because which filter to open on depends on
  // whether anything is waiting — see initialQueueFilter.
  const [filter, setFilter] = useState<QueueFilter | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { open } = await getHomeChanges();
      setDocuments(open);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to load your change requests.",
      );
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (documents ? buildQueueRows(documents, currentUsername) : []),
    [documents, currentUsername],
  );
  const counts = useMemo(() => countQueueRows(rows), [rows]);

  useEffect(() => {
    if (documents !== null && filter === null) {
      setFilter(initialQueueFilter(counts));
    }
  }, [documents, filter, counts]);

  const activeFilter = filter ?? "all";
  const visible = useMemo(
    () => filterQueueRows(rows, activeFilter),
    [rows, activeFilter],
  );

  return (
    <div className="docw-page queue-page">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            <h1 className="doc-header-title">Change requests</h1>
            <p className="doc-header-fact">
              {documents === null
                ? "Gathering what is in flight…"
                : describeQueue(counts)}
            </p>
          </div>
        </div>
      </header>

      {error ? <p className="app-inline-error">{error}</p> : null}

      {documents === null ? (
        <SkeletonGroup label="Loading change requests">
          <SkeletonLine width="medium" />
          <SkeletonLine width="wide" />
          <SkeletonLine width="wide" />
        </SkeletonGroup>
      ) : rows.length === 0 ? (
        <div className="home-empty">
          <p>Nothing is in flight right now.</p>
          <button
            type="button"
            className="home-row-action"
            onClick={onBrowseDocuments}
          >
            Browse documents
          </button>
        </div>
      ) : (
        <>
          {/* Counters and filters are the same control. A number you cannot
              press is a number you have to go somewhere else to act on. */}
          <div
            className="queue-counters"
            role="group"
            aria-label="Filter changes"
          >
            {(["all", ...QUEUE_FILTERS] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`queue-counter queue-counter--${entry}${
                  activeFilter === entry ? " queue-counter--active" : ""
                }`}
                aria-pressed={activeFilter === entry}
                onClick={() => setFilter(entry)}
              >
                <span className="queue-counter-value">{counts[entry]}</span>
                <span className="queue-counter-label">
                  {QUEUE_FILTER_LABELS[entry]}
                </span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="home-empty">
              <p>
                Nothing here — {QUEUE_FILTER_LABELS[activeFilter]} is empty.
              </p>
            </div>
          ) : (
            <ul className="queue-list">
              {visible.map((row) => (
                <QueueRowItem key={row.key} row={row} onOpen={onOpenChange} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function QueueRowItem({
  row,
  onOpen,
}: {
  row: QueueRow;
  onOpen: (owner: string, repo: string, changeNumber: number) => void;
}) {
  return (
    <li className="queue-row">
      <button
        type="button"
        className="queue-row-btn"
        onClick={() => onOpen(row.owner, row.repo, row.number)}
      >
        <span className="queue-row-main">
          <span className="queue-row-title">{row.title}</span>
          <span className="queue-row-meta">
            {row.binderName} · {row.documentName} · {row.requestedBy} ·{" "}
            {row.movedWhen}
          </span>
        </span>

        <span className="queue-row-standing">
          {row.waitingOnYou ? (
            <span className="queue-row-flag">Waiting on you</span>
          ) : null}
          <span className={`queue-row-status queue-row-status--${row.status}`}>
            {row.progress ? (
              <span className="queue-row-progress">{row.progress}</span>
            ) : null}
            <span className="queue-row-reason">
              {row.status === "ready" && row.becomesVersion !== null
                ? `Ready to publish · becomes v${row.becomesVersion}`
                : row.statusReason}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
