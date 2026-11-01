import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type HomeOpenDocument } from "../api";
import { homeChangesQuery } from "../data/queries";
import {
  buildQueueRows,
  describeQueue,
  groupQueueRows,
  QUEUE_SECTION_EMPTY,
  QUEUE_SECTION_LABELS,
  QUEUE_SECTIONS,
} from "../reviewQueue";
import { decidedRowsFrom } from "../homeChanges";
import { SkeletonPanel } from "./Skeleton";
import { buildBinderUrl } from "../binderShell";
import { ChangeRowView } from "./ChangeRow";

/**
 * Every change in flight, across every binder.
 *
 * The screen the product was missing. Home is a to-do list — it shows what is
 * waiting on you and drops the rest — and a binder's Change requests tab shows
 * one binder. Neither answers "what is going on", which is the question
 * somebody with four binders opens the app with.
 *
 * **A column of sections, one per state**, the way Home is laid out: what is
 * waiting on your review, what was sent back, what is ready to publish, what
 * is waiting on somebody else, and what was decided lately. Every change is in
 * exactly one, so the counts add up to the whole. They were filter tabs over
 * one list, and "Waiting on you" cut across the others — a change ready to
 * publish was listed under both.
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
  // The same question home asks, so the same answer — moving between the two
  // asks nothing new.
  const home = useQuery(homeChangesQuery());
  const documents: HomeOpenDocument[] | null = home.data
    ? home.data.open
    : home.error
      ? []
      : null;
  const error = home.error
    ? home.error.message || "Unable to load your change requests."
    : null;

  const rows = useMemo(
    () => (documents ? buildQueueRows(documents, currentUsername) : []),
    [documents, currentUsername],
  );
  const groups = useMemo(() => groupQueueRows(rows), [rows]);
  const decided = useMemo(
    () => (home.data ? decidedRowsFrom(home.data, currentUsername) : []),
    [home.data, currentUsername],
  );

  return (
    <div className="docw-page queue-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">Change requests</h1>
          <p className="bs-subtitle">
            {documents === null
              ? "Gathering what is in flight…"
              : describeQueue(groups)}
          </p>
        </div>
      </div>

      {error ? <p className="app-inline-error">{error}</p> : null}

      {documents === null ? (
        <SkeletonPanel label="Loading change requests" rows={3} bar right />
      ) : rows.length === 0 && decided.length === 0 ? (
        <div className="home-empty">
          <p>Nothing is in flight right now.</p>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={onBrowseDocuments}
          >
            Browse documents
          </button>
        </div>
      ) : (
        <>
          {/* **One section per state, every change in exactly one**, in the
              order somebody acts on them. An empty section stays, one line
              long: the place a state lives is worth knowing before anything
              is in it. */}
          {QUEUE_SECTIONS.map((section) => {
            const listed = groups[section];
            return (
              <section
                key={section}
                className={`bs-panel queue-section queue-section--${section}`}
                aria-label={QUEUE_SECTION_LABELS[section]}
              >
                <div className="bs-panel-bar">
                  <h2 className="bs-panel-bar-title">
                    {QUEUE_SECTION_LABELS[section]}
                  </h2>
                  {/* Coral only for the one count that is your turn — the
                      same coral Home's own count carries. */}
                  <span
                    className={`bs-section-count${
                      section === "your_review" && listed.length > 0
                        ? " bs-section-count--attention"
                        : ""
                    }`}
                  >
                    {listed.length}
                  </span>
                </div>
                {listed.length === 0 ? (
                  <p className="queue-section-empty">
                    {QUEUE_SECTION_EMPTY[section]}
                  </p>
                ) : (
                  <ul className="bs-row-list">
                    {listed.map((row) => (
                      <ChangeRowView
                        key={row.key}
                        title={row.title}
                        context={row.binderName}
                        meta={row.meta}
                        tone={row.tone}
                        standing={row.standing}
                        commentCount={row.commentCount}
                        href={changeHref(row)}
                        onOpen={() =>
                          onOpenChange(row.owner, row.repo, row.number)
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <section
            className="bs-panel queue-section queue-section--decided"
            aria-label="Recently decided"
          >
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title">Recently decided</h2>
            </div>
            {decided.length === 0 ? (
              <p className="queue-section-empty">
                Nothing you are part of has been decided yet.
              </p>
            ) : (
              <ul className="bs-row-list">
                {decided.map((row) => (
                  <ChangeRowView
                    key={row.key}
                    title={row.title}
                    context={row.documentName}
                    meta={row.meta}
                    tone={row.tone}
                    standing={row.standing}
                    outcome={
                      row.outcome === "published" ? "published" : "declined"
                    }
                    href={changeHref(row)}
                    onOpen={() => onOpenChange(row.owner, row.repo, row.number)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Where a row goes: the change, on its binder. */
function changeHref(row: { owner: string; repo: string; number: number }) {
  return buildBinderUrl({
    org: row.owner,
    binder: row.repo,
    tab: "changes",
    change: row.number,
  });
}
