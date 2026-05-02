import { useEffect, useRef, useState } from "react";
import {
  FileText,
  GitPullRequest,
  Search,
  Tag,
  Users,
} from "lucide-react";
import { getWorkspaceDocuments, type WorkspaceDocumentSummary } from "../api";
import { BindersnapLogoMark } from "./BindersnapLogoMark";

interface DocumentsPageProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
}

type SortOption = "updated" | "name" | "status";

const DEFAULT_QUERY = "contributed-by:@me";
const MY_DOCS_QUERY = "owner:@me";

function readQueryFromUrl(): string {
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function queryToSearchBarValue(q: string): string {
  return q === "" ? DEFAULT_QUERY : q;
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
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (months > 0)
      return `Updated ${months} month${months > 1 ? "s" : ""} ago`;
    if (weeks > 0) return `Updated ${weeks} week${weeks > 1 ? "s" : ""} ago`;
    if (days > 0) return `Updated ${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `Updated ${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0)
      return `Updated ${minutes} minute${minutes > 1 ? "s" : ""} ago`;
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
    case "draft":
      return "Draft";
  }
}

function getStatusClass(
  status: "in_review" | "approved" | "changes_requested" | "draft",
): string {
  switch (status) {
    case "in_review":
      return "docs-status-badge docs-status-badge--review";
    case "approved":
      return "docs-status-badge docs-status-badge--approved";
    case "changes_requested":
      return "docs-status-badge docs-status-badge--changes";
    case "draft":
      return "docs-status-badge docs-status-badge--draft";
  }
}

function sortDocs(
  docs: WorkspaceDocumentSummary[],
  sort: SortOption,
): WorkspaceDocumentSummary[] {
  return [...docs].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.repo.name.localeCompare(b.repo.name);
      case "status": {
        const order = {
          approved: 0,
          in_review: 1,
          changes_requested: 2,
          draft: 3,
        };
        return order[getDocStatus(a)] - order[getDocStatus(b)];
      }
      case "updated":
      default:
        return (
          new Date(b.repo.updated_at).getTime() -
          new Date(a.repo.updated_at).getTime()
        );
    }
  });
}

function navigateToQuery(q: string, replace = false): void {
  const normalised = q.trim();
  const url =
    normalised === "" || normalised === DEFAULT_QUERY
      ? "/documents"
      : `/documents?q=${encodeURIComponent(normalised)}`;
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isScopeTab(
  activeQ: string,
  tab: "contributions" | "my-docs",
): boolean {
  if (tab === "contributions") {
    return activeQ === "" || activeQ === DEFAULT_QUERY;
  }
  return activeQ === MY_DOCS_QUERY;
}

export function DocumentsPage({
  currentUsername,
  onSelectDocument,
}: DocumentsPageProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The active query (from URL) drives data fetching.
  const [activeQ, setActiveQ] = useState<string>(readQueryFromUrl);
  // The search bar input (may differ from activeQ while the user types).
  const [inputValue, setInputValue] = useState<string>(() =>
    queryToSearchBarValue(readQueryFromUrl()),
  );

  const [sort, setSort] = useState<SortOption>("updated");

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state when the user navigates with browser back/forward.
  useEffect(() => {
    const handler = () => {
      const q = readQueryFromUrl();
      setActiveQ(q);
      setInputValue(queryToSearchBarValue(q));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Fetch documents whenever activeQ changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Send the raw query; when empty the API returns contributed-by:@me results.
    const apiQ = activeQ === DEFAULT_QUERY ? "" : activeQ;

    getWorkspaceDocuments(apiQ || undefined)
      .then((docs) => {
        if (!cancelled) {
          setDocuments(docs);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load documents.",
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeQ]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = inputValue.trim();
    navigateToQuery(q === DEFAULT_QUERY ? "" : q);
  }

  function handleTabClick(tab: "contributions" | "my-docs") {
    const q = tab === "my-docs" ? MY_DOCS_QUERY : "";
    navigateToQuery(q);
  }

  const filtered = sortDocs(documents, sort);

  const totalDocuments = documents.length;
  const totalResults = filtered.length;

  const isContributionsTab = isScopeTab(activeQ, "contributions");
  const isMyDocsTab = isScopeTab(activeQ, "my-docs");

  return (
    <div className="docs-page app-page-shell">
      {/* Hero search bar */}
      <form
        className="docs-hero-search"
        onSubmit={handleSearchSubmit}
        role="search"
      >
        <Search
          size={18}
          strokeWidth={1.5}
          className="docs-hero-search-icon"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          className="docs-hero-search-input"
          placeholder={`Try owner:@${currentUsername || "me"} or contributed-by:@someone`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          aria-label="Search documents"
          autoComplete="off"
          spellCheck={false}
        />
        {inputValue !== "" && (
          <button
            type="button"
            className="docs-hero-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setInputValue(DEFAULT_QUERY);
              navigateToQuery("");
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </form>

      <div className="docs-controls-card">
        {/* Scope tabs */}
        <div className="docs-scope-tabs">
          <button
            type="button"
            className={`docs-scope-tab${isContributionsTab ? " docs-scope-tab--active" : ""}`}
            onClick={() => handleTabClick("contributions")}
          >
            My Contributions
          </button>
          <button
            type="button"
            className={`docs-scope-tab${isMyDocsTab ? " docs-scope-tab--active" : ""}`}
            onClick={() => handleTabClick("my-docs")}
          >
            My Documents
          </button>
        </div>

        {/* Sort toolbar */}
        <div className="docs-toolbar">
          <div className="docs-toolbar-right">
            <span className="docs-toolbar-label">Sort</span>
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
      </div>

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
          <p className="docs-empty-title">No documents found.</p>
          <p className="docs-empty-sub">
            {isContributionsTab
              ? "You haven't contributed to any documents yet."
              : "No documents matched your search."}
          </p>
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
                    <p className="docs-list-item-description">
                      {doc.repo.description}
                    </p>
                  )}

                  <div className="docs-list-item-meta">
                    <span className="docs-list-item-owner">
                      <Users size={12} strokeWidth={1.5} aria-hidden="true" />
                      {owner}
                    </span>
                    {openPRs > 0 && (
                      <span className="docs-list-item-prs">
                        <GitPullRequest
                          size={12}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
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
          Showing {totalResults} of {totalDocuments} document
          {totalDocuments !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
