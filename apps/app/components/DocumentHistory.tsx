import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye } from "lucide-react";

import type { DocumentVersionRecord, VersionReview } from "../api";
import { getDocumentHistory } from "../api";
import {
  capitalizeFirst,
  describeSubmission,
  formatShortDate,
  formatTimestamp,
  parseSubmissionSummary,
} from "../documentDisplay";
import { ReviewDiscussion } from "./ReviewDiscussion";

interface DocumentHistoryProps {
  owner: string;
  repo: string;
  /** Version currently open in the Document tab, highlighted in the list. */
  viewingVersion: number | null;
  hasCanonicalFile: boolean;
  downloadingRef: string | null;
  onDownloadVersion: (tagName: string, version: number) => void;
  onViewVersion: (tagName: string, version: number) => void;
}

function summarizeApprovals(reviews: VersionReview[]): string {
  const approvers = reviews
    .filter((review) => review.state === "approved")
    .map((review) => review.author.fullName?.trim() || review.author.login);

  const unique = [...new Set(approvers)];
  if (unique.length === 0) return "No recorded approval";
  if (unique.length === 1) return `Approved by ${capitalizeFirst(unique[0]!)}`;
  return `Approved by ${capitalizeFirst(unique[0]!)} and ${unique.length - 1} other${
    unique.length === 2 ? "" : "s"
  }`;
}

/**
 * The audit trail, as a timeline.
 *
 * Each published version expands into the record that produced it: who
 * submitted it, every review that was filed, and the discussion that went with
 * it. This is the product's whole promise — "which version did we approve, and
 * who said yes?" — so it gets a first-class page instead of a list of tags.
 */
export function DocumentHistory({
  owner,
  repo,
  viewingVersion,
  hasCanonicalFile,
  downloadingRef,
  onDownloadVersion,
  onViewVersion,
}: DocumentHistoryProps) {
  const [versions, setVersions] = useState<DocumentVersionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await getDocumentHistory(owner, repo);
      setVersions(payload.versions);
      // Open the newest version so the page never lands on a wall of rows.
      const newest = payload.versions[0]?.version;
      setExpanded(newest === undefined ? new Set() : new Set([newest]));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the version history.",
      );
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(version: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  if (isLoading) {
    return (
      <section className="doc-panel doc-empty">
        <h2>Loading version history…</h2>
        <p>Fetching every published version and the reviews behind it.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="doc-panel doc-empty">
        <h2>Unable to load the history</h2>
        <p>{error}</p>
        <button
          className="bs-btn bs-btn-primary"
          type="button"
          onClick={() => void load()}
        >
          Retry
        </button>
      </section>
    );
  }

  if (versions.length === 0) {
    return (
      <section className="doc-panel doc-empty">
        <h2>No published versions yet</h2>
        <p>
          The first approved version starts the record. Everything after it —
          who changed what, who signed off, and when — lands here.
        </p>
      </section>
    );
  }

  return (
    <ol className="doc-history">
      {versions.map((entry) => {
        const isOpen = expanded.has(entry.version);
        const isViewing = viewingVersion === entry.version;
        const submitter = entry.submission?.submittedBy
          ? capitalizeFirst(entry.submission.submittedBy)
          : null;
        const summary = parseSubmissionSummary(entry.submission?.body ?? null);

        return (
          <li
            className={`doc-history-entry${isViewing ? " doc-history-entry--viewing" : ""}`}
            key={entry.tagName}
          >
            <div className="doc-history-row">
              <button
                className="doc-history-toggle"
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(entry.version)}
              >
                {isOpen ? (
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ChevronRight
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                )}
                <span className="vault-version-badge">v{entry.version}</span>
                <span className="doc-history-summary">
                  <span className="doc-history-title">
                    {summary ??
                      (submitter
                        ? `Submitted by ${submitter}`
                        : `Version ${entry.version}`)}
                  </span>
                  <span className="doc-history-sub">
                    {formatShortDate(entry.createdAt)} ·{" "}
                    {summarizeApprovals(entry.reviews)}
                    {entry.discussionCount > 0
                      ? ` · ${entry.discussionCount} comment${
                          entry.discussionCount === 1 ? "" : "s"
                        }`
                      : ""}
                  </span>
                </span>
              </button>

              <div className="doc-history-actions">
                <button
                  className="bs-btn bs-btn-secondary doc-history-btn"
                  type="button"
                  onClick={() => onViewVersion(entry.tagName, entry.version)}
                >
                  <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
                  View
                </button>
                {hasCanonicalFile ? (
                  <button
                    className="bs-btn bs-btn-secondary doc-history-btn vault-version-download"
                    type="button"
                    disabled={downloadingRef === entry.tagName}
                    onClick={() =>
                      onDownloadVersion(entry.tagName, entry.version)
                    }
                  >
                    <Download size={14} strokeWidth={1.5} aria-hidden="true" />
                    {downloadingRef === entry.tagName
                      ? "Downloading…"
                      : `Download v${entry.version}`}
                  </button>
                ) : null}
              </div>
            </div>

            {isOpen ? (
              <div className="doc-history-detail">
                <dl className="doc-history-facts">
                  <div>
                    <dt>Published</dt>
                    <dd>{formatTimestamp(entry.createdAt) || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Submitted by</dt>
                    <dd>
                      {submitter ?? "Unknown"}
                      {entry.submission?.submittedAt
                        ? ` · ${formatShortDate(entry.submission.submittedAt)}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Commit</dt>
                    <dd>
                      <code>{entry.sha.slice(0, 10)}</code>
                    </dd>
                  </div>
                </dl>

                {/* One log, not two: the reviews and the discussion are the
                    same sequence of events, so the version shows the same
                    timeline the change's own page shows. */}
                {entry.submission ? (
                  <ReviewDiscussion
                    owner={owner}
                    repo={repo}
                    pullNumber={entry.submission.number}
                    opening={{
                      author: entry.submission.submittedBy,
                      at: entry.submission.submittedAt,
                      body: describeSubmission(entry.submission.body),
                    }}
                    reviews={entry.reviews}
                    closing={{
                      kind: "published",
                      actor: entry.submission.mergedBy,
                      at: entry.submission.mergedAt ?? entry.createdAt,
                      publishedVersion: entry.version,
                    }}
                    canParticipate={false}
                    blockOnUnresolvedThreads={false}
                  />
                ) : (
                  <p className="vault-pr-notice">
                    No submission record was kept for this version.
                  </p>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
