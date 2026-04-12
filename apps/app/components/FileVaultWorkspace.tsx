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

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
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
      return "Awaiting Approval";
    case "published":
      return "Published";
    default:
      return "Draft";
  }
}

/** Returns an extra CSS class for a card's left-border status indicator. */
function getCardStatusClass(state: string | null): string {
  switch (state) {
    case "in_review":
      return "vault-doc-card--review";
    case "approved":
      return "vault-doc-card--approved";
    case "changes_requested":
      return "vault-doc-card--changes";
    default:
      return "";
  }
}

type TriageFilter = "needs_review" | "waiting" | "approved" | "changes" | null;

export function FileVaultWorkspace({
  currentUsername,
  onSelectDocument,
}: FileVaultWorkspaceProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<TriageFilter>(null);
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
  }, [isLoadingDocuments, documents, activeFilter]);

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
          <div className="bs-eyebrow">Documents</div>
          <h2>No documents yet.</h2>
          <p>
            Create your first document to start tracking versions and approvals.
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

  // ── Triage counts ────────────────────────────────────────────────────────
  const triageCounts = {
    needs_review: documents.filter((d) =>
      d.pendingPRs.some(
        (pr) =>
          pr.approvalState === "in_review" &&
          pr.user?.login !== currentUsername,
      ),
    ).length,
    waiting: documents.filter((d) =>
      d.pendingPRs.some(
        (pr) =>
          pr.approvalState === "in_review" &&
          pr.user?.login === currentUsername,
      ),
    ).length,
    approved: documents.filter(
      (d) => d.latestTag != null && d.pendingPRs.length === 0,
    ).length,
    changes: documents.filter((d) =>
      d.pendingPRs.some((pr) => pr.approvalState === "changes_requested"),
    ).length,
  };

  function matchesFilter(
    document: WorkspaceDocumentSummary,
    filter: TriageFilter,
  ): boolean {
    if (filter === null) return true;
    if (filter === "needs_review") {
      return document.pendingPRs.some(
        (pr) =>
          pr.approvalState === "in_review" &&
          pr.user?.login !== currentUsername,
      );
    }
    if (filter === "waiting") {
      return document.pendingPRs.some(
        (pr) =>
          pr.approvalState === "in_review" &&
          pr.user?.login === currentUsername,
      );
    }
    if (filter === "approved") {
      return document.latestTag != null && document.pendingPRs.length === 0;
    }
    if (filter === "changes") {
      return document.pendingPRs.some(
        (pr) => pr.approvalState === "changes_requested",
      );
    }
    return true;
  }

  const visibleDocuments = documents.filter((d) =>
    matchesFilter(d, activeFilter),
  );

  function toggleFilter(filter: TriageFilter) {
    setActiveFilter((prev) => (prev === filter ? null : filter));
  }

  return (
    <div className="vault-workspace">
      <div className="vault-workspace-toolbar">
        <div>
          <div className="bs-eyebrow">Documents</div>
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
      <p className="vault-workspace-desc">
        Each card shows the current approved version and any pending approvals.
      </p>

      <div className="vault-triage-strip">
        {triageCounts.needs_review > 0 ? (
          <button
            type="button"
            className={`vault-triage-pill${activeFilter === "needs_review" ? " vault-triage-pill--active-needs-review" : ""}`}
            onClick={() => toggleFilter("needs_review")}
          >
            {triageCounts.needs_review} Awaiting Your Review
          </button>
        ) : null}
        {triageCounts.waiting > 0 ? (
          <button
            type="button"
            className={`vault-triage-pill${activeFilter === "waiting" ? " vault-triage-pill--active-waiting" : ""}`}
            onClick={() => toggleFilter("waiting")}
          >
            {triageCounts.waiting} Awaiting Others
          </button>
        ) : null}
        {triageCounts.approved > 0 ? (
          <button
            type="button"
            className={`vault-triage-pill${activeFilter === "approved" ? " vault-triage-pill--active-approved" : ""}`}
            onClick={() => toggleFilter("approved")}
          >
            {triageCounts.approved} Approved
          </button>
        ) : null}
        {triageCounts.changes > 0 ? (
          <button
            type="button"
            className={`vault-triage-pill${activeFilter === "changes" ? " vault-triage-pill--active-changes" : ""}`}
            onClick={() => toggleFilter("changes")}
          >
            {triageCounts.changes} Changes Requested
          </button>
        ) : null}
      </div>

      <div className="vault-doc-grid" ref={gridRef}>
        {visibleDocuments.map((document, index) => {
          const {
            repo,
            latestTag,
            pendingPRs,
            error: documentError,
          } = document;
          const firstPR = pendingPRs.length > 0 ? pendingPRs[0] : null;
          const mostRecentApprovalState = firstPR?.approvalState ?? null;
          const revealClass = index < 4 ? `bs-reveal bs-reveal-d${index + 1}` : "bs-reveal";
          const cardStatusClass = getCardStatusClass(mostRecentApprovalState);
          const submitterLogin = firstPR?.user?.login ?? null;
          const submittedAt = firstPR?.created_at ?? null;

          return (
            <article
              className={`bs-card vault-doc-card ${cardStatusClass} ${revealClass}`}
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
                        Not yet published
                      </span>
                    )}

                    {pendingPRs.length > 0 ? (
                      <span className="vault-pending-badge">
                        {pendingPRs.length} pending approval{pendingPRs.length === 1 ? "" : "s"}
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
                    {submitterLogin && submittedAt
                      ? `Submitted by ${capitalizeFirst(submitterLogin)} · ${formatRelativeTime(submittedAt)}`
                      : `Updated ${formatRelativeTime(repo.updated_at)}`}
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
