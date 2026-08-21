import { useCallback, useEffect, useState } from "react";
import { Clock, GitPullRequest, Users } from "lucide-react";

import type {
  PullRequestWithApprovalState,
  DocTag,
  RepoBranchProtection,
  ReviewSettings,
  UploadResult,
} from "../api";
import { downloadDocument, getClosedChanges, getDocumentDetail } from "../api";
import type { DocumentChangeView, DocumentTab } from "../routes";
import { describeFileKind } from "../documentFile";
import type { ChangeRecord } from "../documentDisplay";
import {
  capitalizeFirst,
  closedChangeToRecord,
  formatDate,
  formatDocumentName,
  getApprovalStateLabel,
  parseSubmissionSummary,
  toChangeRecord,
} from "../documentDisplay";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import type { ChangeFilter } from "./DocumentChanges";
import { DocumentChanges } from "./DocumentChanges";
import { DocumentCollaborators } from "./DocumentCollaborators";
import { DocumentHistory } from "./DocumentHistory";
import { DocumentPermissions } from "./DocumentPermissions";
import { DocumentPreview } from "./DocumentPreview";
import { UploadModal } from "./UploadModal";

interface DocumentDetailProps {
  owner: string;
  repo: string;
  uploaderSlug: string | null;
  activeView: DocumentTab;
  /** Which change has its own page open, or null for the change list. */
  activeChangeNumber: number | null;
  /** Which half of that change's page: the discussion or the file. */
  activeChangeView: DocumentChangeView;
  onTabChange: (tab: DocumentTab) => void;
  onOpenChange: (pullNumber: number | null, view?: DocumentChangeView) => void;
}

interface CanonicalFileInfo {
  storedFileName: string;
  downloadFileName: string;
}

/** Which version the Document tab is showing. `null` means the latest. */
interface ViewedVersion {
  tagName: string;
  version: number;
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

/**
 * The document workspace.
 *
 * One document, five views: what it says now, what is waiting on a decision,
 * how it got here, who can see it, and how it gets approved. The header names
 * the document and the version on record, and holds still at the same width on
 * every tab — it is a page, not a stack of boxes that resize under you.
 */
export function DocumentDetail({
  owner,
  repo,
  uploaderSlug,
  activeView,
  activeChangeNumber,
  activeChangeView,
  onTabChange,
  onOpenChange,
}: DocumentDetailProps) {
  const [tags, setTags] = useState<DocTag[]>([]);
  const [openPRs, setOpenPRs] = useState<PullRequestWithApprovalState[]>([]);
  const [branchProtection, setBranchProtection] =
    useState<RepoBranchProtection | null>(null);
  const [canonicalFileInfo, setCanonicalFileInfo] =
    useState<CanonicalFileInfo | null>(null);
  const [reviewSettings, setReviewSettings] = useState<ReviewSettings | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [viewedVersion, setViewedVersion] = useState<ViewedVersion | null>(
    null,
  );
  const [downloadState, setDownloadState] = useState<{
    ref: string | null;
    error: string | null;
  }>({ ref: null, error: null });
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("open");
  // Null until something asks for the closed list — it costs a review lookup
  // per closed change, and opening a document should not pay that.
  const [closedChanges, setClosedChanges] = useState<ChangeRecord[] | null>(
    null,
  );
  const [closedState, setClosedState] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });

  const loadDocumentData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const detail = await getDocumentDetail(owner, repo);

      setTags(detail.tags);
      setOpenPRs(detail.openPullRequests);
      setBranchProtection(detail.branchProtection);
      setReviewSettings(detail.reviewSettings ?? null);
      setCanonicalFileInfo(detail.canonicalFile);
      // Whatever just happened may have closed a change. Drop the cached
      // closed list rather than showing a record that is one publish stale;
      // it is refetched only if something asks for it again.
      setClosedChanges(null);
      setClosedState({ loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to load document details.";
      setError(message);
      setTags([]);
      setOpenPRs([]);
      setCanonicalFileInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [owner, repo]);

  const loadClosedChanges = useCallback(async () => {
    setClosedState({ loading: true, error: null });
    try {
      const payload = await getClosedChanges(owner, repo);
      setClosedChanges(payload.changes.map(closedChangeToRecord));
      setClosedState({ loading: false, error: null });
    } catch (err) {
      setClosedState({
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : "Unable to load the closed changes.",
      });
    }
  }, [owner, repo]);

  useEffect(() => {
    void loadDocumentData();
    setChangeFilter("open");
  }, [loadDocumentData]);

  const isAnonymous = uploaderSlug === null;
  const currentUser = uploaderSlug ?? "";
  const documentName = formatDocumentName(repo);
  const latestTag = tags.length > 0 ? tags[0] : null;
  const nextVersion = (latestTag?.version ?? 0) + 1;

  const openChanges = openPRs.map(toChangeRecord);
  const activeChange =
    activeChangeNumber === null
      ? null
      : (openChanges.find((change) => change.number === activeChangeNumber) ??
        closedChanges?.find((change) => change.number === activeChangeNumber) ??
        null);

  // A link to a closed change is the normal way back into the record, so the
  // closed list is fetched on demand rather than only when the filter is used.
  const needsClosedChanges =
    activeView === "changes" &&
    !isLoading &&
    (changeFilter === "closed" ||
      (activeChangeNumber !== null && activeChange === null));

  useEffect(() => {
    if (!needsClosedChanges) return;
    if (closedChanges !== null || closedState.loading || closedState.error) {
      return;
    }
    void loadClosedChanges();
  }, [
    needsClosedChanges,
    closedChanges,
    closedState.loading,
    closedState.error,
    loadClosedChanges,
  ]);

  /**
   * Save a version to disk. `loaded` lets a caller that already holds the
   * bytes — the preview, which just rendered them — skip a second fetch of
   * the same file.
   */
  async function handleDownload(gitRef: string, loaded?: Blob | null) {
    if (!canonicalFileInfo) {
      setDownloadState({
        ref: null,
        error: "Unable to determine which file to download for this document.",
      });
      return;
    }

    if (loaded) {
      triggerBrowserDownload(loaded, canonicalFileInfo.downloadFileName);
      return;
    }

    setDownloadState({ ref: gitRef, error: null });

    try {
      const blob = await downloadDocument(owner, repo, gitRef);
      triggerBrowserDownload(blob, canonicalFileInfo.downloadFileName);
      setDownloadState({ ref: null, error: null });
    } catch (err) {
      setDownloadState({
        ref: null,
        error:
          err instanceof Error ? err.message : "Unable to download document.",
      });
    }
  }

  const handleUploadSuccess = (_result: UploadResult) => {
    setShowUploadModal(false);
    onTabChange("changes");
    void loadDocumentData();
  };

  if (isLoading) {
    return (
      <div className="vault-detail app-page-shell">
        <div className="doc-panel vault-empty-state">
          <div className="bs-eyebrow">Loading</div>
          <h2>Loading document details…</h2>
          <p>Fetching version history and pending approvals.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vault-detail app-page-shell">
        <div className="doc-panel vault-error-state">
          <div className="bs-eyebrow">Error</div>
          <h2>Unable to load document</h2>
          <p>{error}</p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => void loadDocumentData()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const viewingRef = viewedVersion?.tagName ?? "main";
  const isViewingLatest = viewedVersion === null;

  const tabs: { id: DocumentTab; label: string; count?: number }[] = [
    { id: "overview", label: "Document" },
    { id: "changes", label: "Changes", count: openPRs.length },
    { id: "history", label: "History", count: tags.length },
    ...(isAnonymous
      ? []
      : ([
          { id: "collaborators", label: "Team" },
          { id: "permissions", label: "Settings" },
        ] as const)),
  ];

  return (
    <div className="vault-detail app-page-shell">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            <p className="doc-header-path">
              {owner} / {repo}
            </p>
            <h1 className="doc-header-title">{documentName}</h1>
            <div className="doc-header-facts">
              {/* The official version, not a status. A document can have v3
                  published and v4 in review at the same time, so a single
                  status word here was always going to be a lie. */}
              <span className="doc-version-pill">
                {latestTag ? `v${latestTag.version}` : "No version yet"}
              </span>
              {latestTag ? (
                <span className="doc-header-fact">
                  Approved {formatDate(latestTag.created)}
                </span>
              ) : (
                <span className="doc-header-fact">Nothing published yet</span>
              )}
              {canonicalFileInfo ? (
                <span className="doc-header-fact doc-header-file">
                  {canonicalFileInfo.downloadFileName} ·{" "}
                  {describeFileKind(canonicalFileInfo.downloadFileName)}
                </span>
              ) : null}
            </div>
          </div>

          {!isAnonymous ? (
            <div className="doc-header-actions">
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                onClick={() => setShowUploadModal(true)}
              >
                Submit New Version
              </button>
            </div>
          ) : null}
        </div>

        <nav
          className="doc-tabs"
          role="tablist"
          aria-label="Document workspace"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`doc-tab${activeView === tab.id ? " doc-tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? (
                <span className="doc-tab-count">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {downloadState.error ? (
        <p className="vault-pr-error" role="alert">
          {downloadState.error}
        </p>
      ) : null}

      {activeView === "collaborators" && !isAnonymous ? (
        <div className="document-detail-tab-panel">
          <DocumentCollaborators
            owner={owner}
            repo={repo}
            currentUsername={currentUser}
          />
        </div>
      ) : activeView === "permissions" && !isAnonymous ? (
        <div className="document-detail-tab-panel">
          <DocumentPermissions
            owner={owner}
            repo={repo}
            currentUsername={currentUser}
          />
        </div>
      ) : activeView === "changes" && activeChange ? (
        <div className="document-detail-tab-panel">
          <DocumentChangeDetail
            owner={owner}
            repo={repo}
            currentUser={currentUser}
            isAnonymous={isAnonymous}
            change={activeChange}
            view={activeChangeView}
            branchProtection={branchProtection}
            blockOnUnresolvedThreads={
              reviewSettings?.blockOnUnresolvedThreads ?? false
            }
            nextVersion={nextVersion}
            documentName={documentName}
            fileName={canonicalFileInfo?.downloadFileName ?? null}
            downloading={downloadState.ref === activeChange.branchName}
            onDownload={(gitRef, loaded) => void handleDownload(gitRef, loaded)}
            onChanged={loadDocumentData}
            onViewChange={(view) => onOpenChange(activeChange.number, view)}
            onBackToList={() => onOpenChange(null)}
          />
        </div>
      ) : activeView === "changes" &&
        activeChangeNumber !== null &&
        (closedState.loading ||
          (closedChanges === null && closedState.error === null)) ? (
        <div className="document-detail-tab-panel">
          {/* The change is not open, so it is somewhere in the closed list —
              which is only fetched when something actually needs it. */}
          <p className="vault-pr-notice">
            Loading change #{activeChangeNumber}…
          </p>
        </div>
      ) : activeView === "changes" ? (
        <div className="document-detail-tab-panel">
          {activeChangeNumber !== null ? (
            <p className="vault-pr-notice">
              Change #{activeChangeNumber} is not on this document.
            </p>
          ) : null}
          <DocumentChanges
            isAnonymous={isAnonymous}
            filter={changeFilter}
            openChanges={openChanges}
            closedChanges={closedChanges}
            closedLoading={closedState.loading}
            closedError={closedState.error}
            nextVersion={nextVersion}
            onFilterChange={setChangeFilter}
            onOpenChange={onOpenChange}
            onRetryClosed={() => void loadClosedChanges()}
            onSubmitVersion={() => setShowUploadModal(true)}
          />
        </div>
      ) : activeView === "history" ? (
        <div className="document-detail-tab-panel">
          <DocumentHistory
            owner={owner}
            repo={repo}
            viewingVersion={viewedVersion?.version ?? null}
            hasCanonicalFile={canonicalFileInfo !== null}
            downloadingRef={downloadState.ref}
            onDownloadVersion={(tagName) => void handleDownload(tagName)}
            onViewVersion={(tagName, version) => {
              setViewedVersion(
                latestTag?.name === tagName ? null : { tagName, version },
              );
              onTabChange("overview");
            }}
          />
        </div>
      ) : (
        <div className="doc-workspace">
          <div className="doc-workspace-main">
            {!isViewingLatest ? (
              <div className="doc-version-notice" role="status">
                <span>
                  Viewing <strong>v{viewedVersion?.version}</strong>, an earlier
                  approved version.
                </span>
                <button
                  className="bs-btn bs-btn-secondary doc-history-btn"
                  type="button"
                  onClick={() => setViewedVersion(null)}
                >
                  Back to latest
                </button>
              </div>
            ) : null}

            {/* Nothing has been approved, so there is no official version to
                read. Asking for one anyway just to render "not found" in an
                empty frame is the app failing at a question it already knows
                the answer to. */}
            {latestTag === null && isViewingLatest ? (
              <div className="doc-nothing-published">
                <h2 className="doc-nothing-published-title">
                  No official version yet
                </h2>
                <p className="doc-nothing-published-note">
                  {openChanges.length > 0
                    ? "A version is waiting on a decision. Once it is approved and published it appears here as the official record."
                    : "Submit a document for review. Once it is approved it appears here as the official record."}
                </p>
                {openChanges.length > 0 ? (
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("changes")}
                  >
                    Review {openChanges.length} change
                    {openChanges.length === 1 ? "" : "s"}
                  </button>
                ) : null}
              </div>
            ) : (
              <DocumentPreview
                owner={owner}
                repo={repo}
                gitRef={viewingRef}
                fileName={canonicalFileInfo?.downloadFileName ?? null}
                downloading={downloadState.ref === viewingRef}
                onDownload={(loaded) => void handleDownload(viewingRef, loaded)}
              />
            )}
          </div>

          <aside className="doc-rail" aria-label="Document summary">
            <section className="doc-rail-card">
              <h2 className="doc-rail-title">
                {latestTag
                  ? `Official version — v${latestTag.version}`
                  : "No approved version yet"}
              </h2>
              {/* When there is no version, the page itself already says so in
                  full. The rail does not need to say it twice. */}
              {latestTag ? (
                <p className="doc-rail-note">
                  Approved on {formatDate(latestTag.created)}. Approved versions
                  are locked — a change means a new version and a new review.
                </p>
              ) : null}
              <dl className="doc-rail-facts">
                <div>
                  <dt>Owner</dt>
                  <dd>{capitalizeFirst(owner)}</dd>
                </div>
                <div>
                  <dt>Versions</dt>
                  <dd>{tags.length}</dd>
                </div>
                <div>
                  <dt>Open changes</dt>
                  <dd>{openPRs.length}</dd>
                </div>
              </dl>
            </section>

            <section className="doc-rail-card">
              <h2 className="doc-rail-title">
                <GitPullRequest
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                Waiting on a decision
              </h2>
              {openPRs.length === 0 ? (
                <p className="doc-rail-note">
                  Nothing is pending. The approved version above is the current
                  record.
                </p>
              ) : (
                <>
                  <ul className="doc-rail-list">
                    {openPRs.slice(0, 3).map((pr) => (
                      <li key={pr.number}>
                        <button
                          className="doc-rail-link"
                          type="button"
                          onClick={() => onOpenChange(pr.number ?? null)}
                        >
                          <span className="doc-rail-link-title">
                            {parseSubmissionSummary(pr.body) ??
                              `Submitted by ${capitalizeFirst(pr.user?.login ?? "someone")}`}
                          </span>
                          <span className="doc-rail-link-sub">
                            {getApprovalStateLabel(pr.approvalState)}
                            {pr.created_at
                              ? ` · ${formatDate(pr.created_at)}`
                              : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("changes")}
                  >
                    Review {openPRs.length} change
                    {openPRs.length === 1 ? "" : "s"}
                  </button>
                </>
              )}
            </section>

            <section className="doc-rail-card">
              <h2 className="doc-rail-title">
                <Clock size={14} strokeWidth={1.5} aria-hidden="true" />
                Recent versions
              </h2>
              {tags.length === 0 ? (
                <p className="doc-rail-note">No published versions yet.</p>
              ) : (
                <>
                  <ul className="doc-rail-list">
                    {tags.slice(0, 4).map((tag) => (
                      <li key={tag.name}>
                        <button
                          className="doc-rail-link"
                          type="button"
                          onClick={() => onTabChange("history")}
                        >
                          <span className="doc-rail-link-title">
                            <span className="vault-version-badge">
                              v{tag.version}
                            </span>
                          </span>
                          <span className="doc-rail-link-sub">
                            {formatDate(tag.created)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("history")}
                  >
                    View full history
                  </button>
                </>
              )}
            </section>

            {!isAnonymous ? (
              <section className="doc-rail-card">
                <h2 className="doc-rail-title">
                  <Users size={14} strokeWidth={1.5} aria-hidden="true" />
                  Access
                </h2>
                <p className="doc-rail-note">
                  Manage who can read this document and who has to sign off
                  before it publishes.
                </p>
                <div className="doc-rail-actions">
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("collaborators")}
                  >
                    Team
                  </button>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("permissions")}
                  >
                    Settings
                  </button>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      )}

      {showUploadModal && !isAnonymous ? (
        <UploadModal
          owner={owner}
          repo={repo}
          docSlug={repo}
          uploaderSlug={currentUser}
          nextVersion={nextVersion}
          canonicalFileName={canonicalFileInfo?.storedFileName ?? null}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      ) : null}
    </div>
  );
}
