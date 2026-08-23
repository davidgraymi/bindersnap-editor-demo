import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye } from "lucide-react";

import type { DocumentVersionRecord } from "../api";
import { getDocumentHistory } from "../api";
import { publishedVersionToRecord } from "../documentDisplay";
import type { HistoryEntry, HistoryPerson } from "../documentHistory";
import { buildHistoryEntries } from "../documentHistory";
import { PersonAvatar } from "./PersonAvatar";
import { ReviewTimeline } from "./ReviewTimeline";

interface DocumentHistoryProps {
  owner: string;
  repo: string;
  /** Version currently open in the Document tab, highlighted in the list. */
  viewingVersion: number | null;
  hasCanonicalFile: boolean;
  downloadingRef: string | null;
  onDownloadVersion: (tagName: string, version: number) => void;
  onViewVersion: (tagName: string, version: number) => void;
  /** Opens the change review a version came from, in the Changes tab. */
  onOpenChange: (changeNumber: number) => void;
}

/** One name on the spline: a face, who they are, and what they did. */
function SplinePerson({
  person,
  role,
}: {
  person: HistoryPerson;
  role: string;
}) {
  return (
    <span className="doc-spline-person">
      <PersonAvatar person={{ login: person.login, fullName: person.name }} />
      <span className="doc-spline-person-name">{person.name}</span>
      <span className="doc-spline-person-role">{role}</span>
    </span>
  );
}

/**
 * The audit trail, as a spline.
 *
 * Every published version is a knot on one line, and every knot is a change
 * review somebody argued over — so the version is titled with that review and
 * links straight to it. The two people who matter are on the line itself: who
 * wrote the change, and who put it on the record. Expanding a knot replays
 * the reviews and the discussion that got it there.
 */
export function DocumentHistory({
  owner,
  repo,
  viewingVersion,
  hasCanonicalFile,
  downloadingRef,
  onDownloadVersion,
  onViewVersion,
  onOpenChange,
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

  const entries: HistoryEntry[] = buildHistoryEntries(versions, owner, repo);

  return (
    <ol className="doc-spline">
      {entries.map((entry, index) => {
        const record = versions[index]!;
        const isOpen = expanded.has(entry.version);
        const isViewing = viewingVersion === entry.version;

        return (
          <li
            className={`doc-spline-entry${
              isViewing ? " doc-spline-entry--viewing" : ""
            }`}
            key={entry.key}
          >
            <span className="doc-spline-knot" aria-hidden="true">
              {entry.label}
            </span>

            <div className="doc-spline-body">
              <div className="doc-spline-head">
                <h3 className="doc-spline-title">
                  {entry.changeHref && entry.changeNumber !== null ? (
                    <a
                      className="doc-spline-link"
                      href={entry.changeHref}
                      onClick={(event) => {
                        // Let a modifier click open the review in a new tab;
                        // a plain click is a route change, not a page load.
                        if (
                          event.defaultPrevented ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onOpenChange(entry.changeNumber!);
                      }}
                    >
                      {entry.title}
                    </a>
                  ) : (
                    entry.title
                  )}
                  {/* The knot carries the version visually; a reader who
                      cannot see the rail still needs to hear it. */}
                  <span className="sr-only">{entry.label}</span>
                </h3>

                <div className="doc-spline-actions">
                  <button
                    className="bs-btn bs-btn-secondary doc-spline-icon-btn"
                    type="button"
                    title={`View ${entry.label}`}
                    aria-label={`View ${entry.label}`}
                    onClick={() => onViewVersion(entry.tagName, entry.version)}
                  >
                    <Eye size={15} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  {hasCanonicalFile ? (
                    <button
                      className="bs-btn bs-btn-secondary doc-spline-icon-btn vault-version-download"
                      type="button"
                      disabled={downloadingRef === entry.tagName}
                      title={
                        downloadingRef === entry.tagName
                          ? `Downloading ${entry.label}…`
                          : `Download ${entry.label}`
                      }
                      aria-label={
                        downloadingRef === entry.tagName
                          ? `Downloading ${entry.label}…`
                          : `Download ${entry.label}`
                      }
                      onClick={() =>
                        onDownloadVersion(entry.tagName, entry.version)
                      }
                    >
                      <Download
                        size={15}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                </div>
              </div>

              {/* The two people the record is about, on the line itself. */}
              <div className="doc-spline-people">
                {entry.author ? (
                  <SplinePerson person={entry.author} role="wrote" />
                ) : null}
                {entry.publisher ? (
                  <SplinePerson person={entry.publisher} role="published" />
                ) : null}
              </div>

              <p className="doc-spline-meta">
                <time dateTime={record.createdAt} title={entry.publishedAt}>
                  {entry.publishedOn}
                </time>
                {" · "}
                {entry.approvals}
                {entry.comments ? ` · ${entry.comments}` : ""}
              </p>

              <button
                className="doc-spline-toggle"
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(entry.version)}
              >
                {isOpen ? (
                  <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <ChevronRight
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                )}
                {isOpen ? "Hide the review record" : "Show the review record"}
              </button>

              {isOpen ? (
                <div className="doc-spline-detail">
                  <dl className="doc-history-facts">
                    <div>
                      <dt>Published</dt>
                      <dd>{entry.publishedAt}</dd>
                    </div>
                    <div>
                      <dt>Change review</dt>
                      <dd>
                        {entry.changeNumber === null
                          ? "No record kept"
                          : `#${entry.changeNumber}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Commit</dt>
                      <dd>
                        <code>{entry.shortSha}</code>
                      </dd>
                    </div>
                  </dl>

                  {/* One log, not two: the reviews and the discussion are the
                      same sequence of events, so the version shows the same
                      timeline the change's own page shows. */}
                  {record.submission ? (
                    <ReviewTimeline
                      owner={owner}
                      repo={repo}
                      change={publishedVersionToRecord({
                        version: record.version,
                        createdAt: record.createdAt,
                        submission: record.submission,
                        reviews: record.reviews,
                      })}
                      updates={[]}
                      resetsApprovals={false}
                      canParticipate={false}
                      blockOnUnresolvedThreads={false}
                      onOpenUpdate={null}
                    />
                  ) : (
                    <p className="vault-pr-notice">
                      No submission record was kept for {entry.label}.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
