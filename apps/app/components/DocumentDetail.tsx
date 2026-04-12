import { useCallback, useEffect, useState } from "react";

import type { PullRequestWithApprovalState } from "../../../packages/gitea-client/pullRequests";
import type {
  DocTag,
  RepoBranchProtection,
} from "../../../packages/gitea-client/repos";
import type { UploadResult } from "../../../packages/gitea-client/uploads";
import {
  downloadDocument,
  getDocumentDetail,
  publishDocument,
  submitDocumentReview,
} from "../api";
import { DocumentCollaborators } from "./DocumentCollaborators";
import { UploadModal } from "./UploadModal";

interface DocumentDetailProps {
  owner: string;
  repo: string;
  uploaderSlug: string;
  activeView: "overview" | "collaborators";
  onTabChange: (tab: "overview" | "collaborators") => void;
  onBack: () => void;
}

interface PRActionState {
  status: "idle" | "submitting" | "done" | "error";
  error: string | null;
  changesComment: string;
  showChangesForm: boolean;
}

interface CanonicalFileInfo {
  storedFileName: string;
  downloadFileName: string;
}

function getApprovalStateBadgeClass(state: string): string {
  switch (state) {
    case "approved":
      return "vault-status-badge vault-status-approved";
    case "changes_requested":
      return "vault-status-badge vault-status-changes";
    case "in_review":
      return "vault-status-badge vault-status-review";
    case "published":
      return "vault-status-badge vault-status-published";
    default:
      return "vault-status-badge vault-status-working";
  }
}

function getApprovalStateLabel(state: string): string {
  switch (state) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes Requested";
    case "in_review":
      return "In Review";
    case "published":
      return "Published";
    default:
      return "Working";
  }
}

function formatDocumentName(repoName: string): string {
  return repoName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "Unknown";

  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
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

function readPermissionError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function canUserReview(
  currentUser: string,
  prAuthor: string | undefined,
  protection: RepoBranchProtection | null,
): { allowed: boolean; reason: string | null } {
  if (currentUser === prAuthor) {
    return {
      allowed: false,
      reason: "You cannot review your own pull request.",
    };
  }
  if (
    protection?.enableApprovalsWhitelist &&
    protection.approvalsWhitelistUsernames.length > 0 &&
    !protection.approvalsWhitelistUsernames.includes(currentUser)
  ) {
    return {
      allowed: false,
      reason: "Your account is not authorized to approve this document.",
    };
  }
  return { allowed: true, reason: null };
}

function canUserMerge(
  currentUser: string,
  protection: RepoBranchProtection | null,
): { allowed: boolean; reason: string | null } {
  if (
    protection?.enableMergeWhitelist &&
    protection.mergeWhitelistUsernames.length > 0 &&
    !protection.mergeWhitelistUsernames.includes(currentUser)
  ) {
    return {
      allowed: false,
      reason: "Your account is not authorized to publish this document.",
    };
  }
  return { allowed: true, reason: null };
}

const DEFAULT_PR_ACTION_STATE: PRActionState = {
  status: "idle",
  error: null,
  changesComment: "",
  showChangesForm: false,
};

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    ref: string | null;
    error: string | null;
  }>({ ref: null, error: null });
  const [prActionStates, setPrActionStates] = useState<
    Record<number, PRActionState>
  >({});

  const loadDocumentData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const detail = await getDocumentDetail(owner, repo);

      setTags(detail.tags);
      setOpenPRs(detail.openPullRequests);
      setBranchProtection(detail.branchProtection);
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

  const latestTag = tags.length > 0 ? tags[0] : null;
  const nextVersion = (latestTag?.version ?? 0) + 1;

  function getPRActionState(pullNumber: number): PRActionState {
    return prActionStates[pullNumber] ?? DEFAULT_PR_ACTION_STATE;
  }

  function updatePRActionState(
    pullNumber: number,
    update: Partial<PRActionState>,
  ) {
    setPrActionStates((prev) => ({
      ...prev,
      [pullNumber]: {
        ...(prev[pullNumber] ?? DEFAULT_PR_ACTION_STATE),
        ...update,
      },
    }));
  }

  async function handleApprove(pullNumber: number) {
    updatePRActionState(pullNumber, { status: "submitting", error: null });
    try {
      await submitDocumentReview(
        owner,
        repo,
        pullNumber,
        "APPROVE",
        "APPROVED",
      );
      updatePRActionState(pullNumber, { status: "idle" });
      await loadDocumentData();
    } catch (err) {
      updatePRActionState(pullNumber, {
        status: "error",
        error: readPermissionError(err, "Failed to submit approval."),
      });
    }
  }

  async function handleRequestChanges(pullNumber: number) {
    const comment = getPRActionState(pullNumber).changesComment.trim();
    if (!comment) {
      updatePRActionState(pullNumber, {
        error: "Enter a comment describing the required changes.",
      });
      return;
    }
    updatePRActionState(pullNumber, { status: "submitting", error: null });
    try {
      await submitDocumentReview(
        owner,
        repo,
        pullNumber,
        "REQUEST_CHANGES",
        comment,
      );
      updatePRActionState(pullNumber, {
        status: "idle",
        showChangesForm: false,
        changesComment: "",
      });
      await loadDocumentData();
    } catch (err) {
      updatePRActionState(pullNumber, {
        status: "error",
        error: readPermissionError(err, "Failed to request changes."),
      });
    }
  }

  async function handleMerge(pullNumber: number) {
    updatePRActionState(pullNumber, { status: "submitting", error: null });
    try {
      await publishDocument(owner, repo, pullNumber, nextVersion);
      updatePRActionState(pullNumber, { status: "idle" });
      await loadDocumentData();
    } catch (err) {
      updatePRActionState(pullNumber, {
        status: "error",
        error: readPermissionError(err, "Failed to publish document."),
      });
    }
  }

  async function handleDownload(ref: string) {
    if (!canonicalFileInfo) {
      setDownloadState({
        ref: null,
        error: "Unable to determine which file to download for this document.",
      });
      return;
    }

    setDownloadState({ ref, error: null });

    try {
      const blob = await downloadDocument(owner, repo, ref);
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
    void loadDocumentData();
  };

  if (isLoading) {
    return (
      <div className="vault-detail">
        <div className="bs-card vault-empty-state">
          <div className="bs-eyebrow">Loading</div>
          <h2>Loading document details...</h2>
          <p>Fetching version history and pending reviews from Gitea.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vault-detail">
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

  return (
    <div className="vault-detail">
      <section className="vault-section">
        <div className="bs-eyebrow">Document Detail</div>
        <h1>{formatDocumentName(repo)}</h1>
        <p className="vault-repo-path">
          {owner}/{repo}
        </p>
        <div
          className="document-detail-nav"
          role="tablist"
          aria-label="Document pages"
        >
          <button
            className={`document-detail-tab${activeView === "overview" ? " document-detail-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeView === "overview"}
            onClick={() => onTabChange("overview")}
          >
            Overview
          </button>
          <button
            className={`document-detail-tab${activeView === "collaborators" ? " document-detail-tab-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeView === "collaborators"}
            onClick={() => onTabChange("collaborators")}
          >
            Collaborators
          </button>
        </div>
      </section>

      {activeView === "collaborators" ? (
        <DocumentCollaborators
          owner={owner}
          repo={repo}
          currentUsername={uploaderSlug}
        />
      ) : (
        <>
          <div className="vault-overview-grid">
            <div className="vault-overview-left">
              <section className="bs-card vault-section">
                <div className="bs-eyebrow">Current Version</div>
            <h2>
              {latestTag ? `Version ${latestTag.version}` : "Unpublished"}
            </h2>
            {latestTag ? (
              <>
                <p>
                  Published on {formatTimestamp(latestTag.created)} (tag:{" "}
                  <code>{latestTag.name}</code>)
                </p>
                {canonicalFileInfo ? (
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    disabled={downloadState.ref === "main"}
                    onClick={() => void handleDownload("main")}
                  >
                    {downloadState.ref === "main"
                      ? "Downloading…"
                      : "Download Current Version"}
                  </button>
                ) : (
                  <p>
                    Unable to determine the document file for this repository.
                  </p>
                )}
                {downloadState.error ? (
                  <p className="vault-pr-error" role="alert">
                    {downloadState.error}
                  </p>
                ) : null}
              </>
            ) : (
              <p>
                No published version exists yet. Publish your first version to
                begin tracking releases.
              </p>
            )}
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              onClick={() => setShowUploadModal(true)}
            >
              Upload New Version
            </button>
          </section>
            </div>
            <div className="vault-overview-right">
          {openPRs.length > 0 ? (
            <section className="bs-card vault-section">
              <div className="bs-eyebrow">Pending Reviews</div>
              <h2>
                {openPRs.length} Open Pull Request
                {openPRs.length === 1 ? "" : "s"}
              </h2>
              <div className="vault-pr-list">
                {openPRs.map((pr) => {
                  const prNum = pr.number ?? 0;
                  const actionState = getPRActionState(prNum);
                  const isSubmitting = actionState.status === "submitting";
                  const reviewPerms = canUserReview(
                    uploaderSlug,
                    pr.user?.login,
                    branchProtection,
                  );
                  const mergePerms = canUserMerge(
                    uploaderSlug,
                    branchProtection,
                  );
                  const mergeReady = pr.approvalState === "approved";

                  return (
                    <div className="vault-pr-item" key={pr.number}>
                      <h3 className="vault-pr-title">
                        #{pr.number}: {pr.title}
                      </h3>
                      <div className="vault-pr-meta">
                        <span
                          className={getApprovalStateBadgeClass(
                            pr.approvalState,
                          )}
                        >
                          {getApprovalStateLabel(pr.approvalState)}
                        </span>
                        {pr.head?.ref ? (
                          <span className="vault-pr-branch">{pr.head.ref}</span>
                        ) : null}
                      </div>
                      {pr.body ? (
                        <p className="vault-pr-body">{pr.body}</p>
                      ) : null}

                      {reviewPerms.allowed ? (
                        <div className="vault-pr-actions">
                          <button
                            className="bs-btn bs-btn-secondary"
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => void handleApprove(prNum)}
                          >
                            {isSubmitting ? "Submitting…" : "Approve"}
                          </button>

                          {actionState.showChangesForm ? (
                            <div className="vault-pr-comment-form">
                              <textarea
                                className="vault-pr-comment-input"
                                placeholder="Describe what needs to change…"
                                value={actionState.changesComment}
                                rows={3}
                                disabled={isSubmitting}
                                onChange={(e) =>
                                  updatePRActionState(prNum, {
                                    changesComment: e.target.value,
                                    error: null,
                                  })
                                }
                              />
                              <div className="vault-pr-comment-actions">
                                <button
                                  className="bs-btn bs-btn-primary"
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    void handleRequestChanges(prNum)
                                  }
                                >
                                  {isSubmitting
                                    ? "Submitting…"
                                    : "Submit Request"}
                                </button>
                                <button
                                  className="bs-btn bs-btn-secondary"
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    updatePRActionState(prNum, {
                                      showChangesForm: false,
                                      changesComment: "",
                                      error: null,
                                    })
                                  }
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="bs-btn bs-btn-secondary"
                              type="button"
                              disabled={isSubmitting}
                              onClick={() =>
                                updatePRActionState(prNum, {
                                  showChangesForm: true,
                                  error: null,
                                })
                              }
                            >
                              Request Changes
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="vault-pr-notice">{reviewPerms.reason}</p>
                      )}

                      {mergePerms.allowed && mergeReady ? (
                        <div className="vault-pr-actions">
                          <button
                            className="bs-btn bs-btn-primary vault-pr-publish-btn"
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => void handleMerge(prNum)}
                          >
                            {isSubmitting ? "Publishing…" : "Publish"}
                          </button>
                        </div>
                      ) : mergeReady && !mergePerms.allowed ? (
                        <p className="vault-pr-notice">{mergePerms.reason}</p>
                      ) : null}

                      {actionState.error ? (
                        <p className="vault-pr-error" role="alert">
                          {actionState.error}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="bs-card vault-section">
              <div className="bs-eyebrow">Pending Reviews</div>
              <h2>No pending reviews</h2>
              <p>
                All changes have been published. Upload a new version to start a
                review.
              </p>
            </section>
          )}
            </div>
          </div>

          <section className="bs-card vault-section">
            <div className="bs-eyebrow">Version History</div>
            <h2>Published Versions</h2>
            {tags.length > 0 ? (
              <div className="vault-version-list">
                {tags.map((tag) => (
                  <div className="vault-version-item" key={tag.name}>
                    <div className="vault-version-header">
                      <span className="vault-version-badge">
                        v{tag.version}
                      </span>
                      <span className="vault-version-date">
                        {formatTimestamp(tag.created)}
                      </span>
                    </div>
                    <p className="vault-version-sha">
                      Commit: <code>{tag.sha.slice(0, 7)}</code>
                    </p>
                    {canonicalFileInfo ? (
                      <button
                        className="bs-btn bs-btn-secondary vault-version-download"
                        type="button"
                        disabled={downloadState.ref === tag.name}
                        onClick={() => void handleDownload(tag.name)}
                      >
                        {downloadState.ref === tag.name
                          ? "Downloading…"
                          : `Download v${tag.version}`}
                      </button>
                    ) : (
                      <p>No document file is available for this version.</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p>No published versions yet.</p>
            )}
          </section>

          {showUploadModal && (
            <UploadModal
              owner={owner}
              repo={repo}
              docSlug={repo}
              uploaderSlug={uploaderSlug}
              nextVersion={nextVersion}
              canonicalFileName={canonicalFileInfo?.storedFileName ?? null}
              onClose={() => setShowUploadModal(false)}
              onSuccess={handleUploadSuccess}
            />
          )}
        </>
      )}
    </div>
  );
}
