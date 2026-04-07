import { useCallback, useEffect, useState } from "react";

import type { GiteaClient } from "../../../packages/gitea-client/client";
import type { PullRequestWithApprovalState } from "../../../packages/gitea-client/pullRequests";
import type {
  DocTag,
  WorkspaceRepo,
} from "../../../packages/gitea-client/repos";
import { listPullRequests } from "../../../packages/gitea-client/pullRequests";
import {
  getLatestDocTag,
  listWorkspaceRepos,
} from "../../../packages/gitea-client/repos";
import { CreateDocumentModal } from "./CreateDocumentModal";

interface FileVaultWorkspaceProps {
  giteaClient: GiteaClient;
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
}

interface DocumentData {
  repo: WorkspaceRepo;
  latestTag: DocTag | null;
  pendingPRs: PullRequestWithApprovalState[];
  isLoading: boolean;
  error: string | null;
}

function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return "Unknown";

  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Unknown";

    const now = Date.now();
    const diff = now - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
    if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    return "Just now";
  } catch {
    return "Unknown";
  }
}

function formatDocumentName(repoName: string): string {
  return repoName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

export function FileVaultWorkspace({
  giteaClient,
  currentUsername,
  onSelectDocument,
}: FileVaultWorkspaceProps) {
  const [repos, setRepos] = useState<WorkspaceRepo[]>([]);
  const [documentData, setDocumentData] = useState<Map<number, DocumentData>>(
    new Map(),
  );
  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);

  const loadRepos = useCallback(async () => {
    setIsLoadingRepos(true);
    setError(null);

    try {
      const workspaceRepos = await listWorkspaceRepos(giteaClient);
      setRepos(workspaceRepos);

      const initialData = new Map<number, DocumentData>();
      for (const repo of workspaceRepos) {
        initialData.set(repo.id, {
          repo,
          latestTag: null,
          pendingPRs: [],
          isLoading: true,
          error: null,
        });
      }
      setDocumentData(initialData);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load workspace repositories.";
      setError(message);
      setRepos([]);
      setDocumentData(new Map());
    } finally {
      setIsLoadingRepos(false);
    }
  }, [giteaClient]);

  const loadDocumentDetails = useCallback(
    async (repo: WorkspaceRepo) => {
      try {
        const [latestTag, pullRequests] = await Promise.all([
          getLatestDocTag(giteaClient, repo.owner.login, repo.name),
          listPullRequests({
            client: giteaClient,
            owner: repo.owner.login,
            repo: repo.name,
            state: "open",
          }),
        ]);

        const uploadPRs = pullRequests.filter((pr) => {
          const headRef = pr.head?.ref ?? "";
          return headRef.startsWith("upload/");
        });

        setDocumentData((prev) => {
          const next = new Map(prev);
          const existing = next.get(repo.id);
          if (existing) {
            next.set(repo.id, {
              ...existing,
              latestTag,
              pendingPRs: uploadPRs,
              isLoading: false,
              error: null,
            });
          }
          return next;
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load document details.";
        setDocumentData((prev) => {
          const next = new Map(prev);
          const existing = next.get(repo.id);
          if (existing) {
            next.set(repo.id, {
              ...existing,
              isLoading: false,
              error: message,
            });
          }
          return next;
        });
      }
    },
    [giteaClient],
  );

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  useEffect(() => {
    for (const repo of repos) {
      void loadDocumentDetails(repo);
    }
  }, [repos, loadDocumentDetails]);

  if (isLoadingRepos) {
    return (
      <div className="vault-workspace">
        <div className="bs-card vault-empty-state">
          <div className="bs-eyebrow">Loading</div>
          <h2>Loading workspace repositories...</h2>
          <p>Fetching your document repositories from Gitea.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vault-workspace">
        <div className="bs-card vault-error-state">
          <div className="bs-eyebrow">Error</div>
          <h2>Unable to load workspace</h2>
          <p>{error}</p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => void loadRepos()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="vault-workspace">
        <div className="bs-card vault-empty-state">
          <div className="bs-eyebrow">Empty Workspace</div>
          <h2>No documents found</h2>
          <p>
            Your workspace is empty. Create a repository in Gitea to get
            started.
          </p>
          <div className="vault-empty-state-actions">
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              onClick={() => setShowCreateDocumentModal(true)}
            >
              New Document
            </button>
          </div>
        </div>

        {showCreateDocumentModal ? (
          <CreateDocumentModal
            giteaClient={giteaClient}
            owner={currentUsername}
            onClose={() => setShowCreateDocumentModal(false)}
            onSuccess={(owner, repo) => {
              setShowCreateDocumentModal(false);
              void loadRepos();
              onSelectDocument(owner, repo);
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="vault-workspace">
      <section className="vault-section">
        <div className="vault-section-header">
          <div>
            <div className="bs-eyebrow">File Vault</div>
            <h1>Your Documents</h1>
          </div>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => setShowCreateDocumentModal(true)}
          >
            New Document
          </button>
        </div>
        <p>
          All documents are stored as Gitea repositories. Each card shows the
          current published version and any pending reviews.
        </p>
      </section>

      <div className="vault-doc-grid">
        {repos.map((repo) => {
          const data = documentData.get(repo.id);
          const latestTag = data?.latestTag ?? null;
          const pendingPRs = data?.pendingPRs ?? [];
          const dataLoading = data?.isLoading ?? false;
          const dataError = data?.error ?? null;

          const mostRecentApprovalState =
            pendingPRs.length > 0 ? pendingPRs[0].approvalState : null;

          return (
            <article
              className="bs-card vault-doc-card"
              key={repo.id}
              onClick={() => onSelectDocument(repo.owner.login, repo.name)}
            >
              <h3 className="vault-doc-card-title">
                {formatDocumentName(repo.name)}
              </h3>
              {repo.description ? (
                <p className="vault-doc-description">{repo.description}</p>
              ) : null}

              {dataLoading ? (
                <p className="vault-doc-loading">Loading details...</p>
              ) : dataError ? (
                <p className="vault-doc-error">{dataError}</p>
              ) : (
                <div className="vault-doc-metadata">
                  <div className="vault-badges">
                    {latestTag ? (
                      <span className="vault-version-badge">
                        v{latestTag.version}
                      </span>
                    ) : (
                      <span className="vault-version-badge vault-no-version">
                        No version
                      </span>
                    )}

                    {pendingPRs.length > 0 ? (
                      <span className="vault-pending-badge">
                        {pendingPRs.length} pending
                      </span>
                    ) : null}

                    {mostRecentApprovalState ? (
                      <span
                        className={getApprovalStateBadgeClass(
                          mostRecentApprovalState,
                        )}
                      >
                        {getApprovalStateLabel(mostRecentApprovalState)}
                      </span>
                    ) : null}
                  </div>

                  <p className="vault-timestamp">
                    Updated {formatRelativeTime(repo.updated_at)}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {showCreateDocumentModal ? (
        <CreateDocumentModal
          giteaClient={giteaClient}
          owner={currentUsername}
          onClose={() => setShowCreateDocumentModal(false)}
          onSuccess={(owner, repo) => {
            setShowCreateDocumentModal(false);
            void loadRepos();
            onSelectDocument(owner, repo);
          }}
        />
      ) : null}
    </div>
  );
}
