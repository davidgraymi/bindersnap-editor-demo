import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkspaceDocuments, type WorkspaceDocumentSummary } from "../api";
import { CreateDocumentModal } from "./CreateDocumentModal";

interface FileVaultWorkspaceProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
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
  currentUsername,
  onSelectDocument,
}: FileVaultWorkspaceProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoadingDocuments(true);
    setError(null);

    try {
      setDocuments(await getWorkspaceDocuments());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load workspace documents.",
      );
      setDocuments([]);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!gridRef.current || isLoadingDocuments) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("bs-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    gridRef.current.querySelectorAll(".bs-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isLoadingDocuments, documents]);

  if (isLoadingDocuments) {
    return (
      <div className="vault-workspace">
        <div className="vault-doc-grid">
          {[1, 2, 3].map((i) => (
            <article key={i} className="bs-card vault-doc-card vault-skeleton-card">
              <div className="vault-skeleton-line vault-skeleton-line--medium" />
              <div className="vault-skeleton-line vault-skeleton-line--wide" />
              <div className="vault-skeleton-line vault-skeleton-line--short" />
            </article>
          ))}
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
            onClick={() => void loadDocuments()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="vault-workspace">
        <div className="bs-card vault-empty-state">
          <div className="bs-eyebrow">File Vault</div>
          <h2>Your vault is ready.</h2>
          <p>
            Add your first document to start tracking versions and reviews.
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
            owner={currentUsername}
            onClose={() => setShowCreateDocumentModal(false)}
            onSuccess={(owner, repo) => {
              setShowCreateDocumentModal(false);
              void loadDocuments();
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
          Each card shows the current published version and any pending reviews.
        </p>
      </section>

      <div className="vault-doc-grid" ref={gridRef}>
        {documents.map((document, index) => {
          const {
            repo,
            latestTag,
            pendingPRs,
            error: documentError,
          } = document;
          const mostRecentApprovalState =
            pendingPRs.length > 0 ? pendingPRs[0].approvalState : null;
          const revealClass = index < 4 ? `bs-reveal bs-reveal-d${index + 1}` : "bs-reveal";

          return (
            <article
              className={`bs-card vault-doc-card ${revealClass}`}
              key={repo.id}
              onClick={() => onSelectDocument(repo.owner.login, repo.name)}
            >
              <h3 className="vault-doc-card-title">
                {formatDocumentName(repo.name)}
              </h3>
              {repo.description ? (
                <p className="vault-doc-description">{repo.description}</p>
              ) : null}

              {documentError ? (
                <p className="vault-doc-error">{documentError}</p>
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
          owner={currentUsername}
          onClose={() => setShowCreateDocumentModal(false)}
          onSuccess={(owner, repo) => {
            setShowCreateDocumentModal(false);
            void loadDocuments();
            onSelectDocument(owner, repo);
          }}
        />
      ) : null}
    </div>
  );
}
