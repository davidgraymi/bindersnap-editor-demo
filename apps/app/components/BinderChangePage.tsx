import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  editBinderChange,
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
  /** Where the required reviewers come from, for the reader who asks. */
  onOpenSignOffRules: () => void;
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
  onOpenSignOffRules,
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
      // **The file path, which carries the identity — not the address.** The
      // file operations on a change read at two refs: the proposed version on
      // the change's branch, and the version it replaces on the base. A change
      // that renames a policy has two different addresses for one document,
      // and the base ref has never heard of the new one. The identity is the
      // thing that is the same at both (ADR 0005), and it rides in the
      // filename.
      documentPath: shown?.path ?? shown?.slugPath ?? "",
    }),
    [org, binder, shown?.path, shown?.slugPath],
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
        // By identity, for the same reason the scope is: a download of the
        // version this change replaces is a read at a ref that does not know
        // the new name.
        (await downloadBinderDocument(
          org,
          binder,
          shown.path || shown.slugPath,
          gitRef,
        ));
      triggerBrowserDownload(blob, downloadFileName(shown));
    } finally {
      setDownloadingRef(null);
    }
  };

  if (error) {
    return (
      <div className="binder-pane">
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
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

  /**
   * What the page has to say before it can be acted on, if anything.
   *
   * **Not above the way back.** The stale-branch banner used to render before
   * the crumbs, so the first sentence on the page was about a state nobody had
   * told you you were in. It is drawn inside the review now, where the reader
   * has the change's own name first.
   */
  const behind =
    detail.isBehind && isOpen ? (
      <div className="bs-note bs-note--warn change-behind" role="status">
        <p>
          <strong>The binder has moved on since this change was made.</strong>{" "}
          Updating it pulls in everything published since. Approvals already
          given are dismissed, because they were for different content.
        </p>
        <button
          className="bs-btn bs-btn--sm bs-btn-secondary"
          type="button"
          disabled={catchingUp}
          onClick={() => void runCatchUp()}
        >
          {catchingUp ? "Bringing up to date…" : "Bring up to date"}
        </button>
      </div>
    ) : null;

  return (
    <div className="binder-pane">
      {catchUpError ? (
        <p className="bs-note bs-note--danger" role="alert">
          {catchUpError}
        </p>
      ) : null}

      <DocumentChangeDetail
        banner={behind}
        documentPicker={
          documents.length > 1 ? (
            /* A change is the unit of approval and may version several
               documents, so when it does, the file screens need to be told
               which one they are showing. */
            <div className="bs-panel">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">
                  This change publishes {documents.length} documents
                </h2>
              </div>
              <ul className="bs-row-list">
                {documents.map((document) => (
                  <li key={document.slugPath}>
                    <button
                      className={`bs-row${document.slugPath === shown?.slugPath ? " bs-row--on" : ""}`}
                      type="button"
                      onClick={() => setViewing(document.slugPath)}
                    >
                      <span className="bs-row-body">
                        <span className="bs-row-name">
                          {describeVersionStep(document, !isOpen)}
                        </span>
                        <span className="bs-row-meta">{document.path}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
        requiredReviewers={detail.requiredReviewers.users}
        onOpenSignOffRules={onOpenSignOffRules}
        onEditSubject={async (subject) => {
          await editBinderChange(org, binder, changeNumber, subject);
          await load();
        }}
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
        // A change that touches no document is a change to this binder's
        // sign-off rules — the one kind that goes through review and versions
        // nothing. Saying so replaces the version wording and the file panel,
        // both of which would otherwise be false.
        subject={
          shown
            ? null
            : {
                title: "Who signs off on each folder",
                description:
                  "This change updates the binder's sign-off rules. It publishes no version.",
              }
        }
        documentName={
          shown ? formatDocumentName(shown.name) : `this binder's rules`
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
            className="bs-linkbtn"
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
