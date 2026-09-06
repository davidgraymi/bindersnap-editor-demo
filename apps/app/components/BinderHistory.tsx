import { useEffect, useState } from "react";

import { fetchBinderHistory } from "../api";
import type { WorkspaceHistoryEntry } from "../../../packages/api-schema/schemas/workspaces";
import { formatDocumentName, formatTimestamp } from "../documentDisplay";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Every version this binder has ever published.
 *
 * ADR 0004 says "who approved v4 of infection control" is answered by tag →
 * commit → pull request → reviews, and that "the record is exact". This is
 * that sentence as a page: each row is a tag, and beside it the change that
 * published it and everyone whose approval stood at the time.
 *
 * It is the binder's, not one document's, because a surveyor's question is
 * usually about the manual rather than about a policy they have already found.
 */

interface BinderHistoryProps {
  org: string;
  binder: string;
  onOpenDocument: (slugPath: string) => void;
  onOpenChange: (changeNumber: number) => void;
}

/** "Alice, and Bob", or nobody when a tag was written outside the app. */
export function describeApprovers(approvers: string[]): string {
  if (approvers.length === 0) return "no recorded approval";
  if (approvers.length === 1) return `approved by ${approvers[0]}`;
  const last = approvers[approvers.length - 1];
  return `approved by ${approvers.slice(0, -1).join(", ")} and ${last}`;
}

/** `nursing/hand-hygiene` → `Hand Hygiene`, with the folder ahead of it. */
export function describeHistoryDocument(
  entry: Pick<WorkspaceHistoryEntry, "name" | "folder">,
): string {
  const name = formatDocumentName(entry.name);
  return entry.folder === "" ? name : `${entry.folder} / ${name}`;
}

export function BinderHistory({
  org,
  binder,
  onOpenDocument,
  onOpenChange,
}: BinderHistoryProps) {
  const [versions, setVersions] = useState<WorkspaceHistoryEntry[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setError(null);

    fetchBinderHistory(org, binder)
      .then((payload) => {
        if (!cancelled) setVersions(payload.versions);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read this binder's history.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (versions === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup
          label="Reading this binder's history"
          className="doc-spline"
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="doc-spline-entry" key={index}>
              <span className="doc-spline-knot" />
              <div className="doc-spline-body">
                <SkeletonLine width="medium" />
                <SkeletonLine width="short" />
              </div>
            </div>
          ))}
        </SkeletonGroup>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="binder-pane">
        {/* Not an error and not a fault: a binder nobody has published in yet
            has no history, which is the ordinary first state. */}
        <p style={{ color: "var(--bs-text-muted)" }}>
          Nothing has been published yet. Every version a change publishes
          appears here, with who approved it.
        </p>
      </div>
    );
  }

  return (
    <div className="binder-pane">
      <ol className="doc-spline">
        {versions.map((entry) => (
          <li className="doc-spline-entry" key={entry.tag}>
            <span className="doc-spline-knot" aria-hidden="true">
              v{entry.version}
            </span>

            <div className="doc-spline-body">
              <div className="doc-spline-head">
                <h3 className="doc-spline-title">
                  <button
                    className="doc-spline-link"
                    type="button"
                    onClick={() => onOpenDocument(entry.slugPath)}
                  >
                    {describeHistoryDocument(entry)}
                  </button>
                  <span className="sr-only">version {entry.version}</span>
                </h3>
                {entry.publishedAt ? (
                  <span className="doc-spline-date">
                    {formatTimestamp(entry.publishedAt)}
                  </span>
                ) : null}
              </div>

              <p className="doc-spline-note">
                {entry.changeNumber === null ? (
                  // A binder is a git repository and somebody may tag it
                  // themselves. The row says so rather than inventing a change.
                  <>Tagged outside Bindersnap · {describeApprovers([])}</>
                ) : (
                  <>
                    <button
                      className="doc-spline-link"
                      type="button"
                      onClick={() => onOpenChange(entry.changeNumber!)}
                    >
                      #{entry.changeNumber}
                    </button>{" "}
                    {entry.submittedBy ? `by ${entry.submittedBy} · ` : ""}
                    {describeApprovers(entry.approvers)}
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
