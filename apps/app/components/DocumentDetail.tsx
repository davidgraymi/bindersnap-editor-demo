import { useCallback, useEffect, useState } from "react";

import type { GiteaClient } from "../../../packages/gitea-client/client";
import type { PullRequestWithApprovalState } from "../../../packages/gitea-client/pullRequests";
import type {
  DocTag,
  RepoBranchProtection,
} from "../../../packages/gitea-client/repos";
import type { UploadResult } from "../../../packages/gitea-client/uploads";
import { getStoredToken } from "../../../packages/gitea-client/auth";
import { GiteaApiError, unwrap } from "../../../packages/gitea-client/client";
import {
  listPullRequests,
  mergePullRequest,
  submitReview,
} from "../../../packages/gitea-client/pullRequests";
import {
  createDocTag,
  getRepoBranchProtection,
  listDocTags,
} from "../../../packages/gitea-client/repos";
import { UploadModal } from "./UploadModal";

interface DocumentDetailProps {
  giteaClient: GiteaClient;
  owner: string;
  repo: string;
  uploaderSlug: string;
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

interface RepoContentsEntry {
  name?: string;
  path?: string;
  type?: string;
}

interface RepoContentsExtResponse {
  dir_contents?: RepoContentsEntry[];
  file_contents?: RepoContentsEntry;
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

function buildRawFileUrl(
  giteaBaseUrl: string,
  owner: string,
  repo: string,
  ref: string,
  canonicalFile: string,
): string {
  return `${giteaBaseUrl}/${owner}/${repo}/raw/${ref}/${canonicalFile}`;
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

function extractFileExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const lastDotIndex = trimmed.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return null;
  }

  return trimmed.slice(lastDotIndex + 1);
}

function buildDownloadFileName(repo: string, storedFileName: string): string {
  const extension = extractFileExtension(storedFileName);
  return extension ? `${repo}.${extension}` : repo;
}

function inferStoredDocumentFileName(
  entries: RepoContentsEntry[],
  repo: string,
): string | null {
  const files = entries.filter(
    (entry): entry is RepoContentsEntry & { name: string } =>
      entry.type === "file" && typeof entry.name === "string",
  );

  const documentFile = files.find(
    (entry) => entry.name === "document" || entry.name.startsWith("document."),
  );
  if (documentFile) {
    return documentFile.name;
  }

  const legacyFile = files.find(
    (entry) => entry.name === repo || entry.name.startsWith(`${repo}.`),
  );
  if (legacyFile) {
    return legacyFile.name;
  }

  if (files.length === 1) {
    return files[0]?.name ?? null;
  }

  return null;
}

async function resolveCanonicalFileInfo(
  giteaClient: GiteaClient,
  owner: string,
  repo: string,
  ref = "main",
): Promise<CanonicalFileInfo | null> {
  const result = await unwrap(
    giteaClient.GET("/repos/{owner}/{repo}/contents-ext/{filepath}", {
      params: {
        path: { owner, repo, filepath: "." },
        query: { ref },
      },
    }),
  );

  const response = result as RepoContentsExtResponse;
  const entries = [
    ...(response.dir_contents ?? []),
    ...(response.file_contents ? [response.file_contents] : []),
  ];
  const storedFileName = inferStoredDocumentFileName(entries, repo);

  if (!storedFileName) {
    return null;
  }

  return {
    storedFileName,
    downloadFileName: buildDownloadFileName(repo, storedFileName),
  };
}

function readPermissionError(err: unknown, fallback: string): string {
  if (err instanceof GiteaApiError && err.status === 403) {
    return "You don't have permission to perform this action.";
  }
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
  giteaClient,
  owner,
  repo,
  uploaderSlug,
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

  const giteaBaseUrl =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
      .env?.VITE_GITEA_BASE_URL ?? "http://localhost:3000";

  const loadDocumentData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [docTags, pullRequests, protection] = await Promise.all([
        listDocTags(giteaClient, owner, repo),
        listPullRequests({
          client: giteaClient,
          owner,
          repo,
          state: "open",
        }),
        getRepoBranchProtection(giteaClient, owner, repo, "main").catch(
          () => null,
        ),
      ]);

      const uploadPRs = pullRequests
        .filter((pr) => (pr.head?.ref ?? "").startsWith("upload/"))
        .sort((left, right) => (right.number ?? 0) - (left.number ?? 0));

      let fileInfo =
        (await resolveCanonicalFileInfo(giteaClient, owner, repo).catch(
          () => null,
        )) ?? null;

      if (!fileInfo) {
        const fallbackRef = uploadPRs[0]?.head?.ref;
        if (fallbackRef) {
          fileInfo =
            (await resolveCanonicalFileInfo(
              giteaClient,
              owner,
              repo,
              fallbackRef,
            ).catch(() => null)) ?? null;
        }
      }

      setTags(docTags);
      setOpenPRs(pullRequests);
      setBranchProtection(protection);
      setCanonicalFileInfo(fileInfo);
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
  }, [giteaClient, owner, repo]);

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
      await submitReview({
        client: giteaClient,
        owner,
        repo,
        pullNumber,
        event: "APPROVE",
        body: "APPROVED",
      });
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
      await submitReview({
        client: giteaClient,
        owner,
        repo,
        pullNumber,
        event: "REQUEST_CHANGES",
        body: comment,
      });
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
      await mergePullRequest({
        client: giteaClient,
        owner,
        repo,
        pullNumber,
        mergeStyle: "merge",
      });
      await createDocTag({
        client: giteaClient,
        owner,
        repo,
        version: nextVersion,
        target: "main",
      });
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

    const token = getStoredToken();
    if (!token) {
      setDownloadState({
        ref: null,
        error: "Your Gitea session expired. Sign in again to download files.",
      });
      return;
    }

    setDownloadState({ ref, error: null });

    try {
      const response = await fetch(
        buildRawFileUrl(
          giteaBaseUrl,
          owner,
          repo,
          ref,
          canonicalFileInfo.storedFileName,
        ),
        {
          headers: {
            Authorization: `token ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
      }

      const blob = await response.blob();
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
        <button
          className="bs-btn bs-btn-secondary"
          type="button"
          onClick={onBack}
        >
          ← Back to workspace
        </button>

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
        <button
          className="bs-btn bs-btn-secondary"
          type="button"
          onClick={onBack}
        >
          ← Back to workspace
        </button>

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
      <button
        className="bs-btn bs-btn-secondary"
        type="button"
        onClick={onBack}
      >
        ← Back to workspace
      </button>

      <section className="vault-section">
        <div className="bs-eyebrow">Document Detail</div>
        <h1>{formatDocumentName(repo)}</h1>
        <p className="vault-repo-path">
          {owner}/{repo}
        </p>
      </section>

      <section className="bs-card vault-section">
        <div className="bs-eyebrow">Current Version</div>
        <h2>{latestTag ? `Version ${latestTag.version}` : "Unpublished"}</h2>
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
              <p>Unable to determine the document file for this repository.</p>
            )}
            {downloadState.error ? (
              <p className="vault-pr-error" role="alert">
                {downloadState.error}
              </p>
            ) : null}
          </>
        ) : (
          <p>
            No published version exists yet. Publish your first version to begin
            tracking releases.
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

      {openPRs.length > 0 ? (
        <section className="bs-card vault-section">
          <div className="bs-eyebrow">Pending Reviews</div>
          <h2>
            {openPRs.length} Open Pull Request{openPRs.length === 1 ? "" : "s"}
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
              const mergePerms = canUserMerge(uploaderSlug, branchProtection);
              const mergeReady = pr.approvalState === "approved";

              return (
                <div className="vault-pr-item" key={pr.number}>
                  <h3 className="vault-pr-title">
                    #{pr.number}: {pr.title}
                  </h3>
                  <div className="vault-pr-meta">
                    <span
                      className={getApprovalStateBadgeClass(pr.approvalState)}
                    >
                      {getApprovalStateLabel(pr.approvalState)}
                    </span>
                    {pr.head?.ref ? (
                      <span className="vault-pr-branch">{pr.head.ref}</span>
                    ) : null}
                  </div>
                  {pr.body ? <p className="vault-pr-body">{pr.body}</p> : null}

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
                              onClick={() => void handleRequestChanges(prNum)}
                            >
                              {isSubmitting ? "Submitting…" : "Submit Request"}
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

      <section className="bs-card vault-section">
        <div className="bs-eyebrow">Version History</div>
        <h2>Published Versions</h2>
        {tags.length > 0 ? (
          <div className="vault-version-list">
            {tags.map((tag) => (
              <div className="vault-version-item" key={tag.name}>
                <div className="vault-version-header">
                  <span className="vault-version-badge">v{tag.version}</span>
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
          giteaClient={giteaClient}
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
    </div>
  );
}
