import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  fetchBinderChange,
  updateBinderChange,
} from "../api";
import { describeVersionStep } from "../binderChange";
import { downloadFileName } from "../binderDocument";
import type { ChangeScope } from "../changeScope";
import { resolveComparisonBase } from "../documentComparison";
import { formatDocumentName, toChangeRecord } from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One change in a binder, at `/{org}/{binder}?tab=changes&change=3`.
 *
 * The review itself is `DocumentChangeDetail` — the same discussion, timeline,
 * comparison, reviewer list and publish gate the per-document workspace has.
 * A change request is a Gitea pull request whether the thing it revises is a
 * repository of its own or a file inside a binder, so a second review screen
 * would only be a second set of wording to keep in step.
 *
 * What is genuinely a binder's own is above it: a change here can touch more
 * than one document, and it can fall behind the binder's `main`.
 */

interface BinderChangePageProps {
  org: string;
  binder: string;
  changeNumber: number;
  currentUser: string;
  view: DocumentChangeView;
  onViewChange: (view: DocumentChangeView) => void;
  onBackToChanges: () => void;
  onOpenDocument: (slugPath: string) => void;
  /** Something about the change moved: the binder's own counts have too. */
  onChanged: () => void;
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function BinderChangePage({
  org,
  binder,
  changeNumber,
  currentUser,
  view,
  onViewChange,
  onBackToChanges,
  onOpenDocument,
  onChanged,
}: BinderChangePageProps) {
  const [detail, setDetail] = useState<WorkspaceChangeDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** Which of the change's documents the file screens are about. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const [catchUpError, setCatchUpError] = useState<string | null>(null);
  const [downloadingRef, setDownloadingRef] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchBinderChange(org, binder, changeNumber));
      setError(null);
      // Approving, publishing or catching up all move the binder's own
      // counts, and the tab bar above is showing them.
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open this change.",
      );
    }
  }, [org, binder, changeNumber, onChanged]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setViewing(null);
    void load();
  }, [load]);

  const documents = detail?.documents ?? [];
  // Held as a path rather than an index so the choice survives a refetch.
  const shown =
    documents.find((document) => document.slugPath === viewing) ??
    documents[0] ??
    null;

  const scope = useMemo<ChangeScope>(
    () => ({
      kind: "binder",
      org,
      binder,
      documentPath: shown?.slugPath ?? "",
    }),
    [org, binder, shown?.slugPath],
  );

  const record = useMemo(
    () =>
      detail
        ? {
            ...toChangeRecord(detail.change),
            // `toChangeRecord` serves the open-changes list, so it assumes
            // open. A decided change is not still awaiting a decision.
            open: detail.change.state === "open",
          }
        : null,
    [detail],
  );

  const runCatchUp = async () => {
    setCatchingUp(true);
    setCatchUpError(null);
    try {
      await updateBinderChange(org, binder, changeNumber);
      await load();
    } catch (err) {
      setCatchUpError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to bring this change up to date.",
      );
    } finally {
      setCatchingUp(false);
    }
  };

  const handleDownload = async (gitRef: string, loaded?: Blob | null) => {
    if (!shown) return;
    setDownloadingRef(gitRef);
    try {
      const blob =
        loaded ??
        (await downloadBinderDocument(org, binder, shown.slugPath, gitRef));
      triggerBrowserDownload(blob, downloadFileName(shown));
    } finally {
      setDownloadingRef(null);
    }
  };

  if (error) {
    return (
      <div className="binder-pane">
        <p className="app-inline-error">{error}</p>
        <p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onBackToChanges}
          >
            Back to change requests
          </button>
        </p>
      </div>
    );
  }

  if (!detail || !record) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Opening this change">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const isOpen = detail.change.state === "open";

  return (
    <div className="binder-pane">
      {/* A binder's change can fall behind: `main` moved on after it branched
          off, and the binder refuses the merge however many approvals it has.
          Said here, above the review, because until it is fixed nothing below
          can finish — and because bringing it up to date dismisses the
          approvals already given. */}
      {detail.isBehind && isOpen ? (
        <div className="change-behind" role="status">
          <div>
            <strong>The binder has moved on since this change was made.</strong>{" "}
            Bringing it up to date merges the binder&rsquo;s current main into
            it. Approvals already given are dismissed, because they were for
            different content.
          </div>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            disabled={catchingUp}
            onClick={() => void runCatchUp()}
          >
            {catchingUp ? "Bringing up to date…" : "Bring up to date"}
          </button>
        </div>
      ) : null}

      {catchUpError ? (
        <p className="vault-pr-error" role="alert">
          {catchUpError}
        </p>
      ) : null}

      {/* Which documents this change is about. A change is the unit of
          approval and may version several, so when it does, the file screens
          below need to be told which one they are showing. */}
      {documents.length > 1 ? (
        <section className="change-documents">
          <h2 className="doc-rail-title">
            This change publishes {documents.length} documents
          </h2>
          <div className="docs-list">
            {documents.map((document) => (
              <button
                className={`docs-list-item${document.slugPath === shown?.slugPath ? " docs-list-item--active" : ""}`}
                type="button"
                key={document.slugPath}
                onClick={() => setViewing(document.slugPath)}
              >
                <span className="docs-list-item-body">
                  <span className="docs-list-item-name">
                    {describeVersionStep(document, !isOpen)}
                  </span>
                  <span className="docs-list-item-meta">{document.path}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <DocumentChangeDetail
        scope={scope}
        currentUser={currentUser}
        isAnonymous={false}
        change={record}
        view={view}
        // The approvals whitelist is admin-only policy about named people, and
        // a binder's page does not ask for it. Null means "no restriction we
        // know of", and Gitea still refuses an approval that does not count.
        branchProtection={null}
        blockOnUnresolvedThreads={detail.blockOnUnresolvedThreads}
        canManageAssignments={detail.canManage}
        nextVersion={shown?.nextVersion ?? 1}
        documentName={
          shown
            ? formatDocumentName(shown.name)
            : `Change #${detail.change.number}`
        }
        fileName={shown ? downloadFileName(shown) : null}
        comparisonBase={
          shown
            ? resolveComparisonBase({
                open: isOpen,
                // What this change published for the document on screen. A
                // published change is read against the version below the one
                // it became, not against today's record — which is itself.
                publishedVersion: isOpen
                  ? null
                  : (shown.currentVersion?.version ?? null),
                tags: shown.versions.map((version) => ({
                  name: version.tag,
                  version: version.version,
                  sha: version.commitSha,
                })),
              })
            : null
        }
        downloading={downloadingRef !== null}
        onDownload={(gitRef, loaded) => void handleDownload(gitRef, loaded)}
        onChanged={load}
        onViewChange={onViewChange}
        onBackToList={onBackToChanges}
      />

      {shown ? (
        <p className="change-open-document">
          <button
            className="doc-rail-card-link"
            type="button"
            onClick={() => onOpenDocument(shown.slugPath)}
          >
            Open {formatDocumentName(shown.name)} in the binder →
          </button>
        </p>
      ) : null}
    </div>
  );
}
