import { useEffect, useState } from "react";
import { Archive } from "lucide-react";

import { fetchBinderArchive, restoreBinderDocument } from "../api";
import type { BinderArchivePayload } from "../../../packages/api-schema/schemas/workspaces";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * What this binder has taken off the record.
 *
 * **Nothing here is lost, and the page says so once rather than reassuring
 * row by row.** Archiving removes a file from `main` and does nothing else:
 * every version tag still points at the commit that held it, git never
 * collects a commit reachable from a ref, and the bytes remain readable at
 * every version the policy ever reached. That is the whole reason the word is
 * "archive" — it is accurate, not softened.
 *
 * **A list computed, not stored.** The server answers it as every identity
 * with a version tag minus every identity on `main`, which is why nothing can
 * drift: there is no second place recording what is archived, so there is
 * nothing for the record to disagree with.
 */

interface BinderArchiveProps {
  org: string;
  binder: string;
  onBack: () => void;
  /**
   * Where a restore goes — the change request it opened.
   *
   * **It proposes rather than acting**, which is why this is a navigation and
   * not a refresh: a policy reappearing on the record without a decision would
   * be the one act in this product that skipped review.
   */
  onProposed: (changeNumber: number) => void;
}

/** "Archived 3 March 2026", or nothing when no tag recorded the date. */
function describeArchived(
  entry: BinderArchivePayload["documents"][number],
): string {
  const parts: string[] = [`Last published as version ${entry.lastVersion}`];

  if (entry.slugPath) parts.push(`Filed at ${entry.slugPath}`);

  if (entry.archivedAt) {
    parts.push(
      `Archived ${new Date(entry.archivedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
    );
  } else {
    // A policy that left before the `archived-<n>` tag existed, or one taken
    // out by somebody working in Gitea directly. Said plainly rather than
    // dated with a guess — a compliance record that invents a date is worse
    // than one that admits to a gap.
    parts.push("No record of when");
  }

  if (entry.archivings !== null && entry.archivings > 1) {
    parts.push(`Archived ${entry.archivings} times`);
  }

  return parts.join(" · ");
}

export function BinderArchive({
  org,
  binder,
  onBack,
  onProposed,
}: BinderArchiveProps) {
  const [payload, setPayload] = useState<BinderArchivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which row is mid-restore, so only its own button says so. */
  const [restoring, setRestoring] = useState<string | null>(null);

  const restore = async (uid: string) => {
    setRestoring(uid);
    setError(null);
    try {
      const proposed = await restoreBinderDocument(org, binder, uid);
      // Never null: this screen names no draft, so the server opened a change
      // request — the same reading every other non-draft caller makes.
      onProposed(proposed.changeNumber ?? 0);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to restore that document.",
      );
      setRestoring(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);

    fetchBinderArchive(org, binder)
      .then((answer) => {
        if (!cancelled) setPayload(answer);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read the archive.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  return (
    <div className="binder-pane">
      <div className="archive-head">
        <button type="button" className="app-breadcrumb-back" onClick={onBack}>
          ← Back to the binder
        </button>
        <h1 className="bs-title">Archive</h1>
        {/* The reassurance, once, at the top. It is the question anybody
            opening this page has, and answering it per row would be eleven
            copies of one sentence. */}
        <p className="propose-lede">
          Taken off the record, and still on it. Every version these documents
          published is unchanged and still readable — archiving removes the file
          from the binder and nothing else.
        </p>
        {/* The one thing restoring does that is not obvious: it waits. */}
        <p className="propose-lede">
          Restoring one opens a change request. It rejoins the binder once that
          is approved and published, at the next version after the one it left
          on.
        </p>
      </div>

      {error ? (
        <p className="app-inline-error" role="alert">
          {error}
        </p>
      ) : payload === null ? (
        <SkeletonGroup label="Reading the archive">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      ) : payload.documents.length === 0 ? (
        <p style={{ color: "var(--bs-text-muted)" }}>
          Nothing has been archived from this binder.
        </p>
      ) : (
        <div className="docs-list">
          {payload.documents.map((entry) => (
            <div
              className="docs-list-item docs-list-item--static"
              key={entry.uid}
            >
              <Archive size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className="docs-list-item-body">
                <span className="docs-list-item-name">{entry.title}</span>
                <span className="docs-list-item-meta">
                  {describeArchived(entry)}
                </span>
              </span>
              {/* It comes back as the next version, not as a new policy at v1
                  — the identity is a segment of the filename and this restores
                  that filename, so the history is unbroken across the gap.
                  Said on the button, because "what happens to its history" is
                  the question somebody hesitating here actually has. */}
              <button
                type="button"
                className="bs-btn bs-btn-secondary archive-restore"
                disabled={restoring !== null}
                onClick={() => void restore(entry.uid)}
              >
                {restoring === entry.uid
                  ? "Opening a change…"
                  : `Restore as version ${entry.lastVersion + 1}`}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
