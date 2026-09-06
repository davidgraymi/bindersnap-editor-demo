import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  fetchBinderChange,
  publishBinderChange,
  reviewBinderChange,
  updateBinderChange,
} from "../api";
import {
  describePublishBlock,
  describePublished,
  describeVersionStep,
} from "../binderChange";
import { downloadFileName } from "../binderDocument";
import {
  formatTimestamp,
  getReviewerDisplayName,
  getReviewerStatusLabel,
  parseChangeTitle,
  resolveReviewerDisplayStatus,
  toChangeRecord,
} from "../documentDisplay";
import { ApprovalMeter } from "./ApprovalMeter";
import { DocumentPreview } from "./DocumentPreview";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One change in a binder, at `/{org}/{binder}?change=3`.
 *
 * ADR 0004 makes the change the unit of approval, so this is its own page
 * rather than a panel under one of the documents it touches: it names every
 * document it would version, shows the file as submitted, says what is
 * standing between it and the record, and is where somebody signs it off.
 */

interface BinderChangePageProps {
  org: string;
  binder: string;
  changeNumber: number;
  /** The reader, so their own reviewer row reads "You". */
  currentUser: string;
  onBackToBinder: () => void;
  onOpenDocument: (slugPath: string) => void;
}

type ActionState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string }
  | { status: "published"; message: string };

export function BinderChangePage({
  org,
  binder,
  changeNumber,
  currentUser,
  onBackToBinder,
  onOpenDocument,
}: BinderChangePageProps) {
  const [detail, setDetail] = useState<WorkspaceChangeDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [comment, setComment] = useState("");
  /** Which of the change's documents is on screen. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await fetchBinderChange(org, binder, changeNumber);
      setDetail(payload);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open this change.",
      );
    }
  }, [org, binder, changeNumber]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setAction({ status: "idle" });
    setViewing(null);
    void load();
  }, [load]);

  const documents = detail?.documents ?? [];
  // The document on screen, defaulting to the first the change touches. Held
  // as a path rather than an index so it survives a refetch.
  const shown =
    documents.find((document) => document.slugPath === viewing) ??
    documents[0] ??
    null;

  const shownPath = shown?.slugPath ?? "";
  const branch = detail?.change.branchName ?? "";

  const loadFile = useCallback(
    (gitRef: string) => downloadBinderDocument(org, binder, shownPath, gitRef),
    [org, binder, shownPath],
  );

  const record = useMemo(
    () =>
      detail
        ? {
            ...toChangeRecord(detail.change),
            // `toChangeRecord` serves the open-changes list, so it assumes
            // open. A decided change is not still "ready to publish", and the
            // meter reads that off this flag.
            open: detail.change.state === "open",
          }
        : null,
    [detail],
  );

  const publishBlock = detail
    ? describePublishBlock({
        change: detail.change,
        isBehind: detail.isBehind,
        blockOnUnresolvedThreads: detail.blockOnUnresolvedThreads,
        unresolvedThreadCount: detail.unresolvedThreadCount,
        documentCount: detail.documents.length,
      })
    : null;

  const runReview = async (
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  ) => {
    setAction({ status: "working" });
    try {
      await reviewBinderChange(
        org,
        binder,
        changeNumber,
        event,
        comment.trim(),
      );
      setComment("");
      await load();
      setAction({ status: "idle" });
    } catch (err) {
      setAction({
        status: "error",
        message:
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to record that review.",
      });
    }
  };

  const runUpdate = async () => {
    setAction({ status: "working" });
    try {
      await updateBinderChange(org, binder, changeNumber);
      await load();
      setAction({ status: "idle" });
    } catch (err) {
      setAction({
        status: "error",
        message:
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to bring this change up to date.",
      });
    }
  };

  const runPublish = async () => {
    setAction({ status: "working" });
    try {
      const published = await publishBinderChange(org, binder, changeNumber);
      setAction({
        status: "published",
        message: describePublished(published.tags),
      });
      await load();
    } catch (err) {
      setAction({
        status: "error",
        // Gitea's own words. The invented ones sent three rounds of debugging
        // after the wrong cause the last time this was guessed at.
        message:
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to publish this change.",
      });
    }
  };

  const handleDownload = async (loaded: Blob | null) => {
    if (!shown) return;
    setDownloading(true);
    try {
      const blob = loaded ?? (await loadFile(branch));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadFileName(shown);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="binder-pane">
        <h1 className="doc-header-title">Change #{changeNumber}</h1>
        <p className="app-inline-error">{error}</p>
        <p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onBackToBinder}
          >
            Back to {binder}
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

  const { change } = detail;
  const submittedBy = change.user?.login ?? "";
  const isBusy = action.status === "working";
  const justPublished = action.status === "published";
  // Merged, or closed by somebody else while this page was open. Either way
  // there is nothing left to decide, and offering the decision would be
  // offering it on a change that no longer exists.
  const isDecided = change.state !== "open" || justPublished;

  return (
    <div className="binder-pane">
      <header className="doc-header doc-header--nested">
        {/* The binder is named above this by the shell, so the trail says the
            one thing it does not: which change you are reading. */}
        <nav className="doc-crumbs" aria-label="Which change this is">
          <span className="doc-crumb">
            <button
              className="app-breadcrumb-back"
              type="button"
              onClick={onBackToBinder}
            >
              Change requests
            </button>
          </span>
          <span className="doc-crumb">
            <span className="app-breadcrumb-sep" aria-hidden="true">
              /
            </span>
            <span className="app-breadcrumb-current">#{change.number}</span>
          </span>
        </nav>

        <div className="doc-header-top">
          <div className="doc-header-identity">
            <h1 className="doc-header-title">
              {parseChangeTitle(change.body, submittedBy)}
            </h1>
            <div className="doc-header-facts">
              <ApprovalMeter change={record} />
              <span className="doc-header-fact">
                Submitted by {submittedBy || "someone"}
                {change.created_at
                  ? ` · ${formatTimestamp(change.created_at)}`
                  : ""}
              </span>
            </div>
          </div>
        </div>
      </header>

      {justPublished ? (
        <p className="vault-pr-notice" role="status">
          {action.message} It is on the record now.
        </p>
      ) : null}

      {action.status === "error" ? (
        <p className="vault-pr-error" role="alert">
          {action.message}
        </p>
      ) : null}

      <div className="doc-workspace">
        <div className="doc-workspace-main">
          {/* What publishing would actually do — named per document, because
              one change can version several and they do not advance in
              lockstep. */}
          <section className="change-documents">
            <h2 className="doc-rail-title">
              {isDecided
                ? "What this change published"
                : "What this change publishes"}
              {documents.length === 1 ? "" : ` · ${documents.length} documents`}
            </h2>
            <div className="docs-list">
              {documents.map((document) => (
                <button
                  className={`docs-list-item${document.slugPath === shownPath ? " docs-list-item--active" : ""}`}
                  type="button"
                  key={document.slugPath}
                  onClick={() => setViewing(document.slugPath)}
                >
                  <span className="docs-list-item-body">
                    <span className="docs-list-item-name">
                      {describeVersionStep(document, isDecided)}
                    </span>
                    <span className="docs-list-item-meta">{document.path}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {shown && branch ? (
            <DocumentPreview
              loadFile={loadFile}
              gitRef={branch}
              fileName={downloadFileName(shown)}
              downloading={downloading}
              onDownload={(loaded) => void handleDownload(loaded)}
            />
          ) : (
            <p className="vault-pr-notice">
              This change has no branch on record, so the submitted file cannot
              be shown.
            </p>
          )}
        </div>

        <aside className="doc-rail" aria-label="Change summary">
          <section className="doc-rail-section">
            <h2 className="doc-rail-title doc-rail-title--urgent">
              The decision
            </h2>
            {isDecided ? (
              <p className="doc-rail-note">
                This change has been published. Its versions are on the record
                and cannot be edited — a revision arrives as a new change.
              </p>
            ) : publishBlock ? (
              <p className="doc-rail-note">{publishBlock}</p>
            ) : (
              <p className="doc-rail-note">
                Approved and ready. Publishing merges the change and writes a
                version for every document above.
              </p>
            )}

            {/* The way out of the dead end. Offered here rather than buried,
                because a change that is behind cannot be published at all —
                and it says what it costs, since moving the branch dismisses
                every approval collected against the old content. */}
            {detail.isBehind && !isDecided ? (
              <>
                <button
                  className="bs-btn bs-btn-secondary"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void runUpdate()}
                >
                  Bring up to date
                </button>
                <p className="doc-rail-note">
                  This merges the binder&rsquo;s current main into the change.
                  Approvals already given are dismissed, because they were for
                  different content.
                </p>
              </>
            ) : null}

            {isDecided ? null : (
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                disabled={isBusy || publishBlock !== null}
                onClick={() => void runPublish()}
              >
                Publish
              </button>
            )}
          </section>

          {isDecided ? null : (
            <section className="doc-rail-section">
              <h2 className="doc-rail-title">Your review</h2>
              <label className="change-review-field">
                <span className="bs-eyebrow">What you want to say</span>
                <textarea
                  className="create-document-input"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Optional for an approval, required to ask for work"
                  disabled={isBusy}
                />
              </label>
              <div className="change-review-actions">
                <button
                  className="bs-btn bs-btn-secondary"
                  type="button"
                  disabled={isBusy}
                  onClick={() => void runReview("APPROVE")}
                >
                  Approve
                </button>
                <button
                  className="bs-btn bs-btn-secondary"
                  type="button"
                  disabled={isBusy || comment.trim() === ""}
                  onClick={() => void runReview("REQUEST_CHANGES")}
                >
                  Ask for changes
                </button>
              </div>
            </section>
          )}

          <section className="doc-rail-section">
            <h2 className="doc-rail-title">Who signs it off</h2>
            {change.reviewers.length === 0 ? (
              <p className="doc-rail-note">
                Nobody has been asked yet. Anyone with write access to this
                binder can approve it.
              </p>
            ) : (
              <div className="doc-rail-card doc-rail-card--rows">
                {change.reviewers.map((reviewer) => (
                  <div
                    className="doc-rail-row doc-rail-row--static"
                    key={reviewer.login}
                  >
                    <span className="doc-rail-row-date">
                      {reviewer.login === currentUser
                        ? "You"
                        : getReviewerDisplayName(reviewer)}
                    </span>
                    <span className="doc-rail-row-note">
                      {getReviewerStatusLabel(
                        resolveReviewerDisplayStatus(reviewer, new Set()),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {shown ? (
            <section className="doc-rail-section">
              <h2 className="doc-rail-title">The document</h2>
              <button
                className="doc-rail-card-link"
                type="button"
                onClick={() => onOpenDocument(shown.slugPath)}
              >
                Open its page →
              </button>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
