import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { fetchBinderHistory } from "../api";
import { followInApp } from "../appLink";
import {
  describeApprovers,
  groupHistoryByChange,
  type HistoryChange,
} from "../binderHistory";
import {
  capitalizeFirst,
  formatAge,
  formatTimestamp,
} from "../documentDisplay";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonLine } from "./Skeleton";

/**
 * The last thing this binder published, above what is in it.
 *
 * **A binder opened cold should say what happened to it last.** GitLab opens
 * a project on its newest commit, above the files, because "is this current"
 * is the first question anybody asks of it — and for a policy binder it is
 * the surveyor's question, word for word. The tree answered it one document
 * at a time, and only for documents still on the record: the change that
 * archived the 2019 supplier terms showed up nowhere on the binder's own page.
 *
 * Read from the binder's history rather than from the tree's rows, because the
 * history is the record — it names who published and who approved, which is
 * the half of the sentence that makes it evidence.
 */

interface BinderLatestChangeProps {
  org: string;
  binder: string;
  /** Where each change is, so the title is a link. */
  changeHref: (changeNumber: number) => string;
  historyHref: string;
  onOpenChange: (changeNumber: number) => void;
  onOpenHistory: () => void;
}

/** "Published by Bob · approved by Carol" — the history's own words. */
export function describeLatestChange(change: HistoryChange): string {
  const publisher = change.submittedBy
    ? `Published by ${capitalizeFirst(change.submittedBy)} · `
    : "";
  // Capitalized as a whole: with no publisher, it starts at "no recorded…".
  return capitalizeFirst(
    `${publisher}${describeApprovers(change.approvers.map(capitalizeFirst))}`,
  );
}

export function BinderLatestChange({
  org,
  binder,
  changeHref,
  historyHref,
  onOpenChange,
  onOpenHistory,
}: BinderLatestChangeProps) {
  // Undefined while loading; null once it is known there is nothing to show.
  const [latest, setLatest] = useState<HistoryChange | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    setLatest(undefined);

    fetchBinderHistory(org, binder)
      .then((payload) => {
        if (cancelled) return;
        setLatest(groupHistoryByChange(payload.versions)[0] ?? null);
      })
      .catch(() => {
        // The card is a summary of a page one click away. Failing to draw it
        // is not worth a banner above the thing somebody came to read.
        if (!cancelled) setLatest(null);
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  // A binder nothing has been published into yet has no last change, and a
  // card saying so would be a box around an empty sentence.
  if (latest === null) return null;

  if (latest === undefined) {
    return (
      <section
        className="bs-panel binder-latest binder-latest--loading"
        aria-busy="true"
        aria-label="Latest change"
      >
        <SkeletonLine width="medium" />
      </section>
    );
  }

  const count = latest.rows.length;
  const number = latest.changeNumber;

  return (
    <section className="bs-panel binder-latest" aria-label="Latest change">
      <PersonAvatar
        person={{ login: latest.submittedBy, fullName: latest.submittedBy }}
        size="md"
      />
      <div className="binder-latest-body">
        {number === null ? (
          <span className="binder-latest-title">{latest.title}</span>
        ) : (
          <a
            className="binder-latest-title"
            href={changeHref(number)}
            onClick={(event) => followInApp(event, () => onOpenChange(number))}
          >
            {latest.title}
          </a>
        )}
        <p className="binder-latest-meta">
          {describeLatestChange(latest)}
          {latest.publishedAt ? (
            <>
              {" · "}
              <time
                dateTime={latest.publishedAt}
                title={formatTimestamp(latest.publishedAt)}
              >
                {formatAge(latest.publishedAt)}
              </time>
            </>
          ) : null}
        </p>
      </div>
      <div className="binder-latest-right">
        <span className="binder-latest-count">
          {count === 1 ? "1 document" : `${count} documents`}
        </span>
        <a
          className="bs-btn bs-btn--sm bs-btn-secondary binder-latest-history"
          href={historyHref}
          onClick={(event) => followInApp(event, onOpenHistory)}
        >
          <History size={14} strokeWidth={1.75} aria-hidden="true" />
          History
        </a>
      </div>
    </section>
  );
}
