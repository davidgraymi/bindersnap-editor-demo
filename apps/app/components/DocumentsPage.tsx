import { useEffect, useState } from "react";
import {
  FileText,
  GitPullRequest,
  Plus,
  Search,
  Tag,
  Users,
} from "lucide-react";
import { getWorkspaceDocuments, type WorkspaceDocumentSummary } from "../api";
import { BindersnapLogoMark } from "./BindersnapLogoMark";

interface DocumentsPageProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
  onNewDocument: () => void;
}

type SortOption = "updated" | "name" | "status";
type FilterStatus = "all" | "draft" | "in_review" | "approved" | "changes_requested";

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
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (months > 0) return `Updated ${months} month${months > 1 ? "s" : ""} ago`;
    if (weeks > 0) return `Updated ${weeks} week${weeks > 1 ? "s" : ""} ago`;
    if (days > 0) return `Updated ${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `Updated ${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `Updated ${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "Updated just now";
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

function getStatusLabel(status: "in_review" | "approved" | "changes_requested" | "draft"): string {
  switch (status) {
    case "in_review": return "In Review";
    case "approved": return "Approved";
    case "changes_requested": return "Changes Requested";
    case "draft": return "Draft";
  }
}

function getStatusClass(status: "in_review" | "approved" | "changes_requested" | "draft"): string {
  switch (status) {
    case "in_review": return "docs-status-badge docs-status-badge--review";
    case "approved": return "docs-status-badge docs-status-badge--approved";
    case "changes_requested": return "docs-status-badge docs-status-badge--changes";
    case "draft": return "docs-status-badge docs-status-badge--draft";
  }
}

function sortDocs(docs: WorkspaceDocumentSummary[], sort: SortOption): WorkspaceDocumentSummary[] {
  return [...docs].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.repo.name.localeCompare(b.repo.name);
      case "status": {
        const order = { approved: 0, in_review: 1, changes_requested: 2, draft: 3 };
        return order[getDocStatus(a)] - order[getDocStatus(b)];
      }
      case "updated":
      default:
        return new Date(b.repo.updated_at).getTime() - new Date(a.repo.updated_at).getTime();
    }
  });
}

export function DocumentsPage({
  currentUsername,
  onSelectDocument,
  onNewDocument,
}: DocumentsPageProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("updated");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getWorkspaceDocuments()
      .then((docs) => {
        if (!cancelled) {
          setDocuments(docs);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load documents.");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const filtered = sortDocs(
    documents.filter((doc) => {
      const status = getDocStatus(doc);
      const matchesSearch =
        !search ||
        doc.repo.name.toLowerCase().includes(search.toLowerCase()) ||
        doc.repo.description.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = filterStatus === "all" || status === filterStatus;
      return matchesSearch && matchesStatus;
    }),
    sort,
  );

  const counts = {
    all: documents.length,
    draft: documents.filter((d) => getDocStatus(d) === "draft").length,
    in_review: documents.filter((d) => getDocStatus(d) === "in_review").length,
    approved: documents.filter((d) => getDocStatus(d) === "approved").length,
    changes_requested: documents.filter((d) => getDocStatus(d) === "changes_requested").length,
  };

  return (
    <div className="docs-page">
      {/* ── PAGE HEADER ── */}
      <div className="docs-page-header">
        <div className="docs-page-header-left">
          <span className="bs-eyebrow">Documents</span>
          <h1 className="docs-page-title">
            {currentUsername ? `${currentUsername}'s Documents` : "My Documents"}
          </h1>
        </div>
        <div className="docs-page-header-right">
          <button
            type="button"
            className="docs-btn-primary"
            onClick={onNewDocument}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            New Document
          </button>
        </div>
      </div>

      {/* ── STATUS FILTER TABS ── */}
      <div className="docs-filter-bar">
        {(["all", "draft", "in_review", "approved", "changes_requested"] as FilterStatus[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`docs-filter-tab${filterStatus === f ? " docs-filter-tab--active" : ""}`}
            onClick={() => setFilterStatus(f)}
          >
            {f === "all" ? "All" :
             f === "draft" ? "Draft" :
             f === "in_review" ? "In Review" :
             f === "approved" ? "Approved" :
             "Changes Requested"}
            <span className="docs-filter-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* ── SEARCH + SORT TOOLBAR ── */}
      <div className="docs-toolbar">
        <div className="docs-toolbar-search">
          <Search size={14} strokeWidth={1.5} className="docs-toolbar-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="docs-toolbar-search-input"
            placeholder="Find a document..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search documents"
          />
        </div>
        <div className="docs-toolbar-right">
          <span className="docs-toolbar-label">Sort:</span>
          <select
            className="docs-toolbar-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            aria-label="Sort documents"
          >
            <option value="updated">Last updated</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      {/* ── DOCUMENT LIST ── */}
      {loading ? (
        <div className="docs-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="docs-list-item docs-list-item--skeleton">
              <div className="docs-skeleton docs-skeleton--icon" />
              <div className="docs-skeleton-body">
                <div className="docs-skeleton docs-skeleton--title" />
                <div className="docs-skeleton docs-skeleton--meta" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bs-card docs-error-card">
          <p className="docs-error-text">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="docs-empty">
          <div className="docs-empty-icon">
            <FileText size={32} strokeWidth={1} aria-hidden="true" />
          </div>
          {search || filterStatus !== "all" ? (
            <>
              <p className="docs-empty-title">No documents match your filters.</p>
              <p className="docs-empty-sub">
                Try a different search or{" "}
                <button
                  type="button"
                  className="docs-empty-reset"
                  onClick={() => { setSearch(""); setFilterStatus("all"); }}
                >
                  clear all filters
                </button>
                .
              </p>
            </>
          ) : (
            <>
              <p className="docs-empty-title">No documents yet.</p>
              <p className="docs-empty-sub">Create your first document to get started.</p>
              <button type="button" className="docs-btn-primary" onClick={onNewDocument}>
                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                New Document
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="docs-list">
          {filtered.map((doc) => {
            const status = getDocStatus(doc);
            const name = formatDocumentName(doc.repo.name);
            const updated = formatRelativeTime(doc.repo.updated_at);
            const openPRs = doc.pendingPRs.length;
            const owner = doc.repo.owner.login;

            return (
              <button
                key={`${owner}/${doc.repo.name}`}
                type="button"
                className="docs-list-item"
                onClick={() => onSelectDocument(owner, doc.repo.name)}
              >
                {/* Icon */}
                <div className="docs-list-item-icon" aria-hidden="true">
                  <BindersnapLogoMark width={18} height={18} />
                </div>

                {/* Main content */}
                <div className="docs-list-item-body">
                  <div className="docs-list-item-top">
                    <span className="docs-list-item-name">{name}</span>
                    <span className={getStatusClass(status)}>
                      {getStatusLabel(status)}
                    </span>
                  </div>

                  {doc.repo.description && (
                    <p className="docs-list-item-description">{doc.repo.description}</p>
                  )}

                  <div className="docs-list-item-meta">
                    <span className="docs-list-item-owner">
                      <Users size={12} strokeWidth={1.5} aria-hidden="true" />
                      {owner}
                    </span>
                    {openPRs > 0 && (
                      <span className="docs-list-item-prs">
                        <GitPullRequest size={12} strokeWidth={1.5} aria-hidden="true" />
                        {openPRs} open {openPRs === 1 ? "request" : "requests"}
                      </span>
                    )}
                    {doc.latestTag && (
                      <span className="docs-list-item-tag">
                        <Tag size={12} strokeWidth={1.5} aria-hidden="true" />
                        {doc.latestTag.name}
                      </span>
                    )}
                    <span className="docs-list-item-updated">{updated}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <p className="docs-result-count">
          Showing {filtered.length} of {documents.length} document{documents.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
