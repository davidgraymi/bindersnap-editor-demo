import { useEffect, useMemo, useState } from "react";
import { Archive, Download, FileText } from "lucide-react";

import { fetchBinderHistory } from "../api";
import { followInApp } from "../appLink";
import type { WorkspaceHistoryEntry } from "../../../packages/api-schema/schemas/workspaces";
import { buildAuditRecord } from "../auditRecord";
import {
  countVersions,
  describePublication,
  filterHistory,
  groupHistoryByChange,
  historyPolicies,
  HISTORY_RANGES,
  type HistoryChange,
  type HistorySince,
} from "../binderHistory";
import { formatDocumentName, formatTimestamp } from "../documentDisplay";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Every change this binder has published, and what each one did.
 *
 * ADR 0004 says "who approved v4 of infection control" is answered by tag →
 * commit → pull request → reviews, and that "the record is exact". This is
 * that sentence as a page.
 *
 * **The knot is the change, not the version** (D9). A version belongs to a
 * document and this timeline belongs to a binder, so a spine of version
 * numbers counted nothing — `v1 · v1 · v1 · v2 · v1` reads as a sequence and
 * is five unrelated documents' first versions. What counts up here is the
 * change, and the versions it wrote sit inside its entry, which is also the
 * only way to draw the thing ADR 0004 exists for: one change, three policies,
 * one merge commit.
 *
 * **A document's history is this same page, filtered** — not a second screen.
 * Build it twice and the two disagree within a month.
 */

interface BinderHistoryProps {
  org: string;
  binder: string;
  onOpenDocument: (slugPath: string, version: number | null) => void;
  onOpenChange: (changeNumber: number) => void;
  /**
   * Where {@link onOpenDocument} and {@link onOpenChange} go, so every change
   * and every version on the spine is a link — one a surveyor can be sent.
   */
  documentHref: (slugPath: string, version: number | null) => string;
  changeHref: (changeNumber: number) => string;
}

/** `nursing/hand-hygiene` → `Hand Hygiene`, with the folder ahead of it. */
export function describeHistoryDocument(
  entry: Pick<WorkspaceHistoryEntry, "name" | "folder">,
): string {
  const name = formatDocumentName(entry.name);
  return entry.folder === ""
    ? name
    : `${formatDocumentName(entry.folder)} / ${name}`;
}

export function BinderHistory({
  org,
  binder,
  onOpenDocument,
  onOpenChange,
  documentHref,
  changeHref,
}: BinderHistoryProps) {
  const [versions, setVersions] = useState<WorkspaceHistoryEntry[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const names = usePeopleNames(org);
  const nameOf = (login: string) => nameFor(names, login);
  const [policy, setPolicy] = useState("");
  const [since, setSince] = useState<HistorySince>("all");

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

  const all = useMemo(() => groupHistoryByChange(versions ?? []), [versions]);
  const shown = useMemo(
    () => filterHistory(all, { slugPath: policy || null, since }),
    [all, policy, since],
  );
  const policies = useMemo(() => historyPolicies(versions ?? []), [versions]);

  /**
   * The record, as a file somebody outside Bindersnap can read.
   *
   * A regulator has no login, so the export cannot be a link into the app. It
   * is built from the history already on screen — nothing is fetched and
   * nothing is stored, so re-exporting the same binder produces the same file.
   * It exports what is filtered, because what is filtered is what was asked
   * for.
   */
  const exportRecord = () => {
    const record = buildAuditRecord({
      organization: org,
      binder,
      versions: shown.flatMap((change) => change.rows),
      generatedAt: new Date(),
    });

    const url = URL.createObjectURL(
      new Blob([record.html], { type: "text/html" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = record.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="binder-pane">
      <div className="bs-panel">
        <div className="bs-panel-bar">
          {/* The whole binder, or one policy. Picking a policy filters the
              spine to the changes that wrote a version of it — same
              structure, narrower question, and its versions then read as the
              sequence they actually are. */}
          <select
            className="bs-input bs-input--sm bs-history-pick"
            value={policy}
            disabled={versions === null || policies.length === 0}
            aria-label="Which document"
            onChange={(event) => setPolicy(event.target.value)}
          >
            <option value="">The whole binder</option>
            {policies.map((entry) => (
              <option key={entry.slugPath} value={entry.slugPath}>
                {describeHistoryDocument(entry)}
              </option>
            ))}
          </select>
          <select
            className="bs-input bs-input--sm bs-history-when"
            value={since}
            disabled={versions === null}
            aria-label="How far back"
            onChange={(event) => setSince(event.target.value as HistorySince)}
          >
            {HISTORY_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          <span className="bs-panel-bar-spacer" />
          {versions === null ? null : (
            <span className="binder-count">
              {shown.length === 1 ? "1 change" : `${shown.length} changes`} ·{" "}
              {countVersions(shown) === 1
                ? "1 version published"
                : `${countVersions(shown)} versions published`}
            </span>
          )}
          {/* An icon, because a download arrow with the word "Download"
              beside it is the word twice — and on the page, because export is
              the honest reason an audit product has a history at all. */}
          <button
            type="button"
            className="bs-actionbtn"
            aria-label="Export this history"
            title="Export"
            disabled={versions === null || shown.length === 0}
            onClick={exportRecord}
          >
            <AppIcon icon={Download} size="md" />
          </button>
        </div>

        {versions === null ? (
          <SkeletonGroup label="Reading this binder's history">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="bs-row" key={index}>
                <span className="bs-skeleton-lines">
                  <SkeletonLine width="medium" />
                  <SkeletonLine width="short" />
                </span>
              </div>
            ))}
          </SkeletonGroup>
        ) : all.length === 0 ? (
          // Not an error and not a fault: a binder nobody has published in
          // yet has no history, which is the ordinary first state.
          <div className="bs-empty">
            <p className="bs-empty-lead">Nothing has been published yet.</p>
            <p>
              Every change this binder publishes appears here, with the versions
              it wrote and who approved them.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="bs-empty">
            <p>Nothing was published in that stretch.</p>
          </div>
        ) : null}
      </div>

      {shown.length === 0 ? null : (
        <ol className="bs-spine">
          {shown.map((change) => (
            <ChangeEntry
              key={
                change.changeNumber === null
                  ? `tag:${change.rows[0]?.tag}`
                  : `change:${change.changeNumber}`
              }
              change={change}
              nameOf={nameOf}
              onOpenDocument={onOpenDocument}
              onOpenChange={onOpenChange}
              documentHref={documentHref}
              changeHref={changeHref}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ChangeEntry({
  change,
  onOpenDocument,
  onOpenChange,
  documentHref,
  changeHref,
  nameOf,
}: {
  change: HistoryChange;
  /** What a login is called, for the line naming who published it. */
  nameOf: (login: string) => string;
  onOpenDocument: (slugPath: string, version: number | null) => void;
  onOpenChange: (changeNumber: number) => void;
  documentHref: (slugPath: string, version: number | null) => string;
  changeHref: (changeNumber: number) => string;
}) {
  const number = change.changeNumber;
  const title =
    change.title ||
    (number === null ? "Tagged outside Bindersnap" : `Change ${number}`);

  return (
    <li className="bs-spine-item">
      {number === null ? (
        // A binder is a git repository and somebody may tag it themselves.
        // The entry says so rather than inventing a change to point at.
        <span className="bs-knot" aria-hidden="true">
          <AppIcon icon={FileText} size="sm" />
        </span>
      ) : (
        <a
          className="bs-knot bs-knot--change"
          href={changeHref(number)}
          aria-label={`Change ${number}`}
          title={`Change ${number}`}
          onClick={(event) => followInApp(event, () => onOpenChange(number))}
        >
          {number}
        </a>
      )}

      <div className="bs-panel">
        <div className="bs-panel-bar">
          <h3 className="bs-panel-bar-title">
            {/* The change's name is the way to it, the way a commit's
                message is on GitLab — the knot is too small to be the only
                one. */}
            {number === null ? (
              title
            ) : (
              <a
                className="bs-spine-title"
                href={changeHref(number)}
                onClick={(event) =>
                  followInApp(event, () => onOpenChange(number))
                }
              >
                {title}
              </a>
            )}
          </h3>
          <span className="bs-panel-bar-spacer" />
          {change.publishedAt ? (
            <span className="binder-count">
              {formatTimestamp(change.publishedAt)}
            </span>
          ) : null}
        </div>

        <ul className="bs-row-list">
          {change.rows.map((row) => (
            <li className="bs-versionrow" key={row.tag}>
              <span className="bs-row-icon">
                <AppIcon
                  icon={row.kind === "archived" ? Archive : FileText}
                  size="sm"
                />
              </span>
              <a
                className="bs-versionrow-name"
                href={documentHref(row.slugPath, row.version)}
                /* **At the version this change wrote, not at whatever the
                   document says now.** This row is evidence of a published
                   version; opening the head would answer a different question
                   than the one that was clicked, and on an audit product the
                   difference is the whole point. An archived row has no
                   version to open at, so it opens the record. */
                onClick={(event) =>
                  followInApp(event, () =>
                    onOpenDocument(row.slugPath, row.version),
                  )
                }
              >
                {formatDocumentName(row.name)}{" "}
                {row.folder === "" ? null : (
                  <span className="bs-versionrow-folder">
                    {formatDocumentName(row.folder)}
                  </span>
                )}
              </a>
              {row.kind === "archived" ? (
                <span className="bs-status bs-status--working">
                  Taken off the record
                </span>
              ) : (
                <span className="bs-status bs-status--approved">
                  <span className="bs-ver">v{row.version}</span>
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="bs-panel-foot">
          {change.submittedBy ? (
            <PersonAvatar
              person={{
                login: change.submittedBy,
                fullName: nameOf(change.submittedBy),
              }}
            />
          ) : null}
          {/* Its own box, so a sentence too long for a phone wraps beside the
              face instead of dropping the whole line below it. */}
          <span className="history-byline">
            {describePublication(change, nameOf)}
          </span>
        </div>
      </div>
    </li>
  );
}
