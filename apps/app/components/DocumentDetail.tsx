import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Clock, GitPullRequest, Users } from "lucide-react";

import type {
  PullRequestWithApprovalState,
  DocTag,
  RepoBranchProtection,
  ReviewSettings,
  UploadResult,
} from "../api";
import { downloadDocument, getDocumentDetail } from "../api";
import type { DocumentTab } from "../routes";
import { describeFileKind } from "../documentFile";
import {
  capitalizeFirst,
  formatDate,
  formatDocumentName,
  getApprovalStateLabel,
  getDocumentStatusLabel,
  parseSubmissionSummary,
  resolveDocumentStatus,
} from "../documentDisplay";
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
  onTabChange: (tab: DocumentTab) => void;
  onBack: () => void;
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
 * how it got here, who can see it, and how it gets approved. The header carries
 * the answer to "where does this stand?" and never changes as you move between
 * tabs, so you always know which document you are looking at.
 */
export function DocumentDetail({
  owner,
  repo,
  uploaderSlug,
  activeView,
  onTabChange,
  onBack,
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

  useEffect(() => {
    void loadDocumentData();
  }, [loadDocumentData]);

  const isAnonymous = uploaderSlug === null;
  const currentUser = uploaderSlug ?? "";
  const documentName = formatDocumentName(repo);
  const latestTag = tags.length > 0 ? tags[0] : null;
  const nextVersion = (latestTag?.version ?? 0) + 1;
  const status = resolveDocumentStatus({
    hasPublishedVersion: latestTag !== null,
    openApprovalStates: openPRs.map((pr) => pr.approvalState),
  });

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
        <div className="bs-card vault-empty-state">
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
        <div className="bs-card vault-error-state">
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
            {!isAnonymous ? (
              <button
                className="doc-header-back"
                type="button"
                onClick={onBack}
              >
                <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                All documents
              </button>
            ) : null}
            <p className="doc-header-path">
              {owner} / {repo}
            </p>
            <h1 className="doc-header-title">{documentName}</h1>
            <div className="doc-header-facts">
              <span className={`doc-status doc-status--${status}`}>
                {getDocumentStatusLabel(status)}
              </span>
              {latestTag ? (
                <span className="doc-header-fact">
                  v{latestTag.version} approved {formatDate(latestTag.created)}
                </span>
              ) : (
                <span className="doc-header-fact">No approved version yet</span>
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
      ) : activeView === "changes" ? (
        <div className="document-detail-tab-panel">
          <DocumentChanges
            owner={owner}
            repo={repo}
            currentUser={currentUser}
            isAnonymous={isAnonymous}
            openPullRequests={openPRs}
            branchProtection={branchProtection}
            blockOnUnresolvedThreads={
              reviewSettings?.blockOnUnresolvedThreads ?? false
            }
            nextVersion={nextVersion}
            documentName={documentName}
            onChanged={loadDocumentData}
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

            <DocumentPreview
              owner={owner}
              repo={repo}
              gitRef={viewingRef}
              fileName={canonicalFileInfo?.downloadFileName ?? null}
              downloading={downloadState.ref === viewingRef}
              onDownload={(loaded) => void handleDownload(viewingRef, loaded)}
            />
          </div>

          <aside className="doc-rail" aria-label="Document summary">
            <section className="bs-card doc-rail-card">
              <h2 className="doc-rail-title">
                {latestTag
                  ? `Official version — v${latestTag.version}`
                  : "No approved version yet"}
              </h2>
              {latestTag ? (
                <p className="doc-rail-note">
                  Approved on {formatDate(latestTag.created)}. Approved versions
                  are locked — a change means a new version and a new review.
                </p>
              ) : (
                <p className="doc-rail-note">
                  Submit a document for review. Once it's approved, it becomes
                  the official record.
                </p>
              )}
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

            <section className="bs-card doc-rail-card">
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
                          onClick={() => onTabChange("changes")}
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

            <section className="bs-card doc-rail-card">
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
              <section className="bs-card doc-rail-card">
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
