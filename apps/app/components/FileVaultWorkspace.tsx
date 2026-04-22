import { useCallback, useEffect, useRef, useState } from "react";

import { getWorkspaceDocuments, type WorkspaceDocumentSummary } from "../api";
import { CreateDocumentModal } from "./CreateDocumentModal";

interface FileVaultWorkspaceProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────

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

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getDisplayFirstName(username: string): string {
  if (!username) return "";
  const parts = username.split(/[\s\-_]+/);
  const first = parts[0] ?? username;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDocStatus(
  doc: WorkspaceDocumentSummary,
): "in_review" | "approved" | "changes_requested" | "draft" {
  const first = doc.pendingPRs[0];
  if (first) {
    const s = first.approvalState;
    if (s === "in_review" || s === "changes_requested" || s === "approved") {
      return s;
    }
  }
  if (doc.latestTag) return "approved";
  return "draft";
}

function getStatusBadgeClass(
  status: "in_review" | "approved" | "changes_requested" | "draft",
): string {
  switch (status) {
    case "in_review":
      return "dash-doc-badge dash-doc-badge--review";
    case "approved":
      return "dash-doc-badge dash-doc-badge--approved";
    case "changes_requested":
      return "dash-doc-badge dash-doc-badge--changes";
    default:
      return "dash-doc-badge dash-doc-badge--draft";
  }
}

function getStatusLabel(
  status: "in_review" | "approved" | "changes_requested" | "draft",
): string {
  switch (status) {
    case "in_review":
      return "In Review";
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes Requested";
    default:
      return "Draft";
  }
}

/** Returns uppercase 2-char initials from a login string */
function loginInitials(login: string): string {
  if (!login) return "?";
  const parts = login.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    return (first[0] ?? "").toUpperCase() + (last[0] ?? "").toUpperCase();
  }
  return login.slice(0, 2).toUpperCase();
}

/** Avatar color palette cycling by first char */
const AVATAR_COLORS: Array<{ bg: string; color: string }> = [
  { bg: "rgba(29,78,216,0.1)", color: "#1D4ED8" },
  { bg: "rgba(180,83,9,0.08)", color: "#b45309" },
  { bg: "rgba(22,163,74,0.1)", color: "#16a34a" },
  { bg: "rgba(232,93,38,0.1)", color: "#e85d26" },
  { bg: "rgba(124,58,237,0.1)", color: "#7c3aed" },
];

function avatarStyle(login: string): { bg: string; color: string } {
  const idx = (login.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  const found = AVATAR_COLORS[idx];
  const fallback = AVATAR_COLORS[0];
  // AVATAR_COLORS always has at least one entry, so fallback is always defined
  return found ?? (fallback as { bg: string; color: string });
}

// ── Skeleton ─────────────────────────────────────────────────

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="dash-skeleton-row" key={i}>
          <div className="dash-skeleton-icon" />
          <div className="dash-skeleton-text">
            <div className="dash-skeleton-line dash-skeleton-line--wide" />
            <div className="dash-skeleton-line dash-skeleton-line--short" />
          </div>
        </div>
      ))}
    </>
  );
}

// ── Component ────────────────────────────────────────────────

export function FileVaultWorkspace({
  currentUsername,
  onSelectDocument,
}: FileVaultWorkspaceProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Listen for topnav "New Document" button
  useEffect(() => {
    const handler = () => setShowCreateDocumentModal(true);
    document.addEventListener("bs:open-create-modal", handler);
    return () => document.removeEventListener("bs:open-create-modal", handler);
  }, []);

  // ── Derived stats ──────────────────────────────────────────

  const awaitingReview = documents.filter((d) =>
    d.pendingPRs.some(
      (pr) =>
        pr.approvalState === "in_review" && pr.user?.login !== currentUsername,
    ),
  ).length;

  const approvedThisMonth = documents.filter(
    (d) => d.latestTag != null && d.pendingPRs.length === 0,
  ).length;

  const allPendingPRs = documents.flatMap((d) =>
    d.pendingPRs.map((pr) => ({ ...pr, docName: d.repo.name, doc: d })),
  );

  const openChangeRequests = allPendingPRs.length;

  const activeContributors = new Set(
    allPendingPRs
      .map((pr) => pr.user?.login)
      .filter((l): l is string => Boolean(l)),
  ).size;

  const docsWithPRCount = new Set(allPendingPRs.map((pr) => pr.docName)).size;

  // Sort docs by most recently updated
  const sortedDocs = [...documents].sort(
    (a, b) =>
      new Date(b.repo.updated_at ?? 0).getTime() -
      new Date(a.repo.updated_at ?? 0).getTime(),
  );

  const recentDocs = sortedDocs.slice(0, 5);

  // Flatten pending PRs across docs, take 4 most recent
  const recentPRs = allPendingPRs
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updated_at ?? 0).getTime() -
        new Date(a.updated_at ?? 0).getTime(),
    )
    .slice(0, 4);

  // Activity feed: derive 6 most recent events from docs
  interface ActivityEntry {
    key: string;
    login: string;
    action: string;
    docName: string;
    docOwner: string;
    docRepo: string;
    time: string;
  }

  const activityEntries: ActivityEntry[] = [];
  for (const doc of sortedDocs) {
    for (const pr of doc.pendingPRs) {
      if (pr.user?.login) {
        activityEntries.push({
          key: `pr-${pr.id}`,
          login: pr.user.login,
          action: "opened a change request on",
          docName: formatDocumentName(doc.repo.name),
          docOwner: doc.repo.owner.login,
          docRepo: doc.repo.name,
          time: formatRelativeTime(pr.created_at ?? ""),
        });
      }
    }
    if (doc.latestTag && doc.pendingPRs.length === 0) {
      activityEntries.push({
        key: `tag-${doc.repo.id}`,
        login: doc.repo.owner.login,
        action: "approved",
        docName: formatDocumentName(doc.repo.name),
        docOwner: doc.repo.owner.login,
        docRepo: doc.repo.name,
        time: formatRelativeTime(doc.repo.updated_at),
      });
    }
  }
  const recentActivity = activityEntries.slice(0, 6);

  // ── Empty state ────────────────────────────────────────────

  if (!isLoadingDocuments && documents.length === 0 && !error) {
    return (
      <div className="dash-inner" ref={containerRef}>
        <div className="dash-page-header">
          <div className="dash-page-header-left">
            <h1>
              {getGreeting()}, {getDisplayFirstName(currentUsername)}
            </h1>
            <p>{getTodayLabel()} · Bindersnap Workspace</p>
          </div>
          <div className="dash-page-header-right">
            <button
              type="button"
              className="dash-btn dash-btn-primary"
              onClick={() => setShowCreateDocumentModal(true)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              New Document
            </button>
          </div>
        </div>

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

  if (error) {
    return (
      <div className="dash-inner">
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

  // ── Main dashboard ─────────────────────────────────────────

  return (
    <div className="dash-inner" ref={containerRef}>
      {/* Page header */}
      <div className="dash-page-header">
        <div className="dash-page-header-left">
          <h1>
            {getGreeting()}, {getDisplayFirstName(currentUsername)}
          </h1>
          <p>{getTodayLabel()} · Bindersnap Workspace</p>
        </div>
        <div className="dash-page-header-right">
          <button
            type="button"
            className="dash-btn dash-btn-secondary"
            aria-label="Import a Word document (coming soon)"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M8 2v9M4 7l4 4 4-4" />
              <path d="M2 13h12" />
            </svg>
            Import .docx
          </button>
          <button
            type="button"
            className="dash-btn dash-btn-primary"
            onClick={() => setShowCreateDocumentModal(true)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            New Document
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="dash-stats-row" aria-label="Workspace summary">
        <div className="dash-stat-card">
          <div className="dash-stat-label">Awaiting Review</div>
          {isLoadingDocuments ? (
            <div
              className="vault-skeleton-line vault-skeleton-line--short"
              style={{ height: "2rem", marginTop: 4 }}
            />
          ) : (
            <div className="dash-stat-value">{awaitingReview}</div>
          )}
          {awaitingReview > 0 ? (
            <div className="dash-stat-sub dash-stat-sub--warning">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3l1.5 1" />
              </svg>
              {awaitingReview} past due
            </div>
          ) : (
            <div className="dash-stat-sub">All clear</div>
          )}
        </div>

        <div className="dash-stat-card">
          <div className="dash-stat-label">Approved This Month</div>
          {isLoadingDocuments ? (
            <div
              className="vault-skeleton-line vault-skeleton-line--short"
              style={{ height: "2rem", marginTop: 4 }}
            />
          ) : (
            <div className="dash-stat-value">{approvedThisMonth}</div>
          )}
          <div className="dash-stat-sub dash-stat-sub--positive">
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M3 9l3 3 7-7" />
            </svg>
            Up to date
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="dash-stat-label">Open Change Requests</div>
          {isLoadingDocuments ? (
            <div
              className="vault-skeleton-line vault-skeleton-line--short"
              style={{ height: "2rem", marginTop: 4 }}
            />
          ) : (
            <div className="dash-stat-value">{openChangeRequests}</div>
          )}
          <div className="dash-stat-sub">
            across {docsWithPRCount} document{docsWithPRCount !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="dash-stat-label">Active Contributors</div>
          {isLoadingDocuments ? (
            <div
              className="vault-skeleton-line vault-skeleton-line--short"
              style={{ height: "2rem", marginTop: 4 }}
            />
          ) : (
            <div className="dash-stat-value">{activeContributors}</div>
          )}
          <div className="dash-stat-sub">this workspace</div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="dash-two-col">
        {/* Left column */}
        <div className="dash-left-col">
          {/* Recent Documents */}
          <div className="dash-section-block">
            <div className="dash-section-head">
              <div className="dash-section-head-left">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--bs-text-faint)" }}
                  aria-hidden="true"
                >
                  <path d="M3 2h7l3 3v9H3V2z" />
                  <path d="M10 2v3h3" />
                </svg>
                <span className="dash-section-title">Recent Documents</span>
                {!isLoadingDocuments ? (
                  <span className="dash-section-count">
                    {documents.length} total
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="dash-section-link"
                onClick={() => undefined}
              >
                View all
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>
            </div>

            {isLoadingDocuments ? (
              <SkeletonRows count={4} />
            ) : recentDocs.length === 0 ? (
              <div className="dash-empty">No documents yet.</div>
            ) : (
              recentDocs.map((doc) => {
                const status = getDocStatus(doc);
                const firstPR = doc.pendingPRs[0];
                const submitter = firstPR?.user?.login ?? doc.repo.owner.login;
                const updatedTime = formatRelativeTime(doc.repo.updated_at);
                const isNative =
                  doc.latestTag != null || doc.pendingPRs.length > 0;

                return (
                  <div
                    key={doc.repo.id}
                    className="dash-doc-item"
                    onClick={() =>
                      onSelectDocument(doc.repo.owner.login, doc.repo.name)
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDocument(doc.repo.owner.login, doc.repo.name);
                      }
                    }}
                  >
                    <div
                      className={`dash-doc-icon ${isNative ? "dash-doc-icon--native" : "dash-doc-icon--word"}`}
                      aria-hidden="true"
                    >
                      {isNative ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 18 18"
                          fill="none"
                        >
                          <rect
                            x="2"
                            y="1"
                            width="9"
                            height="13"
                            rx="1.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                          />
                          <rect
                            x="6"
                            y="4"
                            width="9"
                            height="13"
                            rx="1.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                          />
                        </svg>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
                        </svg>
                      )}
                    </div>

                    <div className="dash-doc-info">
                      <div className="dash-doc-name">
                        {formatDocumentName(doc.repo.name)}
                      </div>
                      <div className="dash-doc-meta">
                        <span>Documents</span>
                        <span
                          className="dash-doc-meta-dot"
                          aria-hidden="true"
                        />
                        <span>
                          Updated {updatedTime} by {submitter}
                        </span>
                      </div>
                    </div>

                    <span className={getStatusBadgeClass(status)}>
                      <span className="dash-badge-dot" aria-hidden="true" />
                      {getStatusLabel(status)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Open Change Requests */}
          <div className="dash-section-block">
            <div className="dash-section-head">
              <div className="dash-section-head-left">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--bs-text-faint)" }}
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="3" />
                  <path d="M5 5L2 2M11 5l3-3M5 11l-3 3M11 11l3 3" />
                </svg>
                <span className="dash-section-title">Open Change Requests</span>
                {!isLoadingDocuments ? (
                  <span className="dash-section-count">
                    {openChangeRequests} open
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="dash-section-link"
                onClick={() => undefined}
              >
                View all
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>
            </div>

            {isLoadingDocuments ? (
              <SkeletonRows count={3} />
            ) : recentPRs.length === 0 ? (
              <div className="dash-empty">No open change requests.</div>
            ) : (
              recentPRs.map((pr) => {
                const submitterLogin = pr.user?.login ?? "unknown";
                const style = avatarStyle(submitterLogin);

                return (
                  <div
                    key={pr.id}
                    className="dash-cr-item"
                    onClick={() =>
                      onSelectDocument(
                        pr.doc.repo.owner.login,
                        pr.doc.repo.name,
                      )
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDocument(
                          pr.doc.repo.owner.login,
                          pr.doc.repo.name,
                        );
                      }
                    }}
                  >
                    <svg
                      className="dash-cr-icon dash-cr-icon--open"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-label="Open"
                    >
                      <circle cx="8" cy="8" r="5.5" />
                      <circle
                        cx="8"
                        cy="8"
                        r="2"
                        fill="currentColor"
                        stroke="none"
                      />
                    </svg>

                    <div className="dash-cr-info">
                      <div className="dash-cr-title">{pr.title}</div>
                      <div className="dash-cr-meta">
                        {formatDocumentName(pr.docName)} · opened{" "}
                        {formatRelativeTime(pr.created_at ?? "")} by{" "}
                        {submitterLogin}
                      </div>
                    </div>

                    <div
                      className="dash-cr-reviewer"
                      aria-label={`Reviewer: ${submitterLogin}`}
                    >
                      <div
                        className="dash-cr-avatar"
                        style={{
                          background: style.bg,
                          color: style.color,
                        }}
                      >
                        {loginInitials(submitterLogin)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="dash-right-col">
          {/* Quick Actions */}
          <div
            className="dash-section-block"
            style={{ marginBottom: "var(--brand-space-5)" }}
          >
            <div className="dash-section-head">
              <div className="dash-section-head-left">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--bs-text-faint)" }}
                  aria-hidden="true"
                >
                  <path d="M13 3L7 9M3 9l1-5 5-1M8 12l4 1-1-4" />
                </svg>
                <span className="dash-section-title">Quick Actions</span>
              </div>
            </div>

            <div className="dash-quick-actions">
              <button
                type="button"
                className="dash-qa-btn"
                onClick={() => setShowCreateDocumentModal(true)}
              >
                <svg
                  className="dash-qa-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
                <span className="dash-qa-label">New Document</span>
                <span className="dash-qa-sub">Start from scratch</span>
              </button>

              <button
                type="button"
                className="dash-qa-btn"
                aria-label="Import Word document (coming soon)"
              >
                <svg
                  className="dash-qa-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M8 2v9M4 7l4 4 4-4" />
                  <path d="M2 13h12" />
                </svg>
                <span className="dash-qa-label">Import Word</span>
                <span className="dash-qa-sub">Upload .docx file</span>
              </button>

              <button
                type="button"
                className="dash-qa-btn"
                aria-label="Export audit log (coming soon)"
              >
                <svg
                  className="dash-qa-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" />
                </svg>
                <span className="dash-qa-label">Export Audit Log</span>
                <span className="dash-qa-sub">Download CSV / PDF</span>
              </button>

              <button
                type="button"
                className="dash-qa-btn"
                aria-label="Invite people (coming soon)"
              >
                <svg
                  className="dash-qa-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14s-1 0-1-1 1-4 7-4 7 3 7 4-1 1-1 1H2z" />
                  <path d="M13 7v4M11 9h4" />
                </svg>
                <span className="dash-qa-label">Invite People</span>
                <span className="dash-qa-sub">Add team members</span>
              </button>
            </div>
          </div>

          {/* Activity */}
          <div className="dash-section-block">
            <div className="dash-section-head">
              <div className="dash-section-head-left">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  style={{ color: "var(--bs-text-faint)" }}
                  aria-hidden="true"
                >
                  <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
                  <circle cx="8" cy="8" r="2" />
                </svg>
                <span className="dash-section-title">Activity</span>
              </div>
              <button
                type="button"
                className="dash-section-link"
                onClick={() => undefined}
              >
                All
              </button>
            </div>

            {isLoadingDocuments ? (
              <SkeletonRows count={4} />
            ) : recentActivity.length === 0 ? (
              <div className="dash-empty">No recent activity.</div>
            ) : (
              recentActivity.map((entry) => {
                const style = avatarStyle(entry.login);
                const isCurrentUser = entry.login === currentUsername;
                const displayLogin = isCurrentUser
                  ? "You"
                  : entry.login.charAt(0).toUpperCase() + entry.login.slice(1);

                return (
                  <div className="dash-activity-item" key={entry.key}>
                    <div
                      className="dash-activity-avatar"
                      style={{ background: style.bg, color: style.color }}
                      aria-hidden="true"
                    >
                      {loginInitials(entry.login)}
                    </div>
                    <div className="dash-activity-body">
                      <div className="dash-activity-text">
                        <strong>{displayLogin}</strong> {entry.action}{" "}
                        <button
                          type="button"
                          onClick={() =>
                            onSelectDocument(entry.docOwner, entry.docRepo)
                          }
                        >
                          {entry.docName}
                        </button>
                      </div>
                      <div className="dash-activity-time">{entry.time}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Create Document Modal */}
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
