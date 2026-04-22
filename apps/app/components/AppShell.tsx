import type { AppRoute } from "../routes";
import { ActivityLogPage } from "./ActivityLogPage";
import { DocumentDetail } from "./DocumentDetail";
import { FileVaultWorkspace } from "./FileVaultWorkspace";
import { InboxPage } from "./InboxPage";

interface AppShellProps {
  user: {
    username: string;
    fullName?: string;
  } | null;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
  onSignOut: () => void | Promise<void>;
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("bs-theme", next);
}

/** Derive uppercase initials from a username or full name. */
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    return (first[0] ?? "").toUpperCase() + (last[0] ?? "").toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function AppShell({
  user,
  route,
  onNavigate,
  onSignOut,
}: AppShellProps) {
  const isDocumentRoute = route.kind === "document";
  const isWorkspace = route.kind === "workspace";
  const isInbox = route.kind === "inbox";

  const displayName = user?.fullName ?? user?.username ?? "";
  const initials = displayName ? getInitials(displayName) : "?";

  return (
    <div className="app-shell">
      {/* ── TOP NAV ── */}
      <header className="app-topnav">
        {/* Logo / page title */}
        <div className="app-topnav-logo">
          <div className="app-topnav-logo-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
              <rect
                x="2"
                y="1"
                width="9"
                height="13"
                rx="1.5"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
              />
              <rect
                x="6"
                y="4"
                width="9"
                height="13"
                rx="1.5"
                stroke="white"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </div>
          {isDocumentRoute
            ? `${route.owner} / ${route.repo}`
            : "Dashboard"}
        </div>

        <>
          {/* Search */}
            <div className="app-nav-search" role="search">
              <svg
                className="app-nav-search-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="6.5" cy="6.5" r="4.5" />
                <path d="M10 10l3 3" />
              </svg>
              <input
                className="app-nav-search-input"
                type="text"
                placeholder="Search documents, changes…"
                aria-label="Search documents and changes"
              />
              <span className="app-nav-search-kbd" aria-hidden="true">
                /
              </span>
            </div>

            {/* Nav links */}
            <nav className="app-topnav-links" aria-label="Main navigation">
              <button
                type="button"
                className={`app-topnav-link${isWorkspace ? " app-topnav-link--active" : ""}`}
                onClick={() => onNavigate({ kind: "workspace" })}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="5" height="5" rx="1" />
                  <rect x="9" y="2" width="5" height="5" rx="1" />
                  <rect x="2" y="9" width="5" height="5" rx="1" />
                  <rect x="9" y="9" width="5" height="5" rx="1" />
                </svg>
                Overview
              </button>
              <button
                type="button"
                className="app-topnav-link"
                onClick={() => onNavigate({ kind: "workspace" })}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M3 4h10M3 8h10M3 12h6" />
                </svg>
                Documents
              </button>
              <button
                type="button"
                className={`app-topnav-link${isInbox ? " app-topnav-link--active" : ""}`}
                onClick={() => onNavigate({ kind: "inbox" })}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="3" />
                  <path d="M5 5L2 2M11 5l3-3M5 11l-3 3M11 11l3 3" />
                </svg>
                Changes
              </button>
              <button
                type="button"
                className="app-topnav-link"
                onClick={() => undefined}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M12 13v-1a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v1" />
                  <circle cx="7" cy="5" r="3" />
                  <path d="M14 13v-1a4 4 0 0 0-2-3.5" />
                </svg>
                People
              </button>
            </nav>
          </>

        <div className="app-topnav-spacer" />

        {/* Right side actions */}
        <div className="app-topnav-right">
          {/* New Document button — only on non-document routes */}
          {!isDocumentRoute ? (
            <>
              <button
                className="app-topnav-new-btn"
                type="button"
                id="topnav-new-doc-btn"
                onClick={() => {
                  // trigger the modal inside FileVaultWorkspace via a custom event
                  document.dispatchEvent(
                    new CustomEvent("bs:open-create-modal"),
                  );
                }}
              >
                <svg
                  width="12"
                  height="12"
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
              <div className="app-topnav-divider" aria-hidden="true" />
            </>
          ) : null}

          {/* Notifications */}
          <button
            className="app-topnav-icon-btn"
            type="button"
            aria-label="Notifications"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M8 1.5a5 5 0 0 1 5 5v2.5l1 2H2l1-2V6.5a5 5 0 0 1 5-5z" />
              <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
            </svg>
          </button>

          {/* Theme toggle */}
          <button
            className="bs-theme-toggle app-topnav-icon-btn"
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            title="Toggle dark / light mode"
          >
            <svg
              className="bs-icon-moon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            <svg
              className="bs-icon-sun"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </button>

          {/* Avatar */}
          <div
            className="app-topnav-avatar"
            title={displayName || user?.username}
            aria-label={`User: ${displayName || user?.username}`}
          >
            {initials}
          </div>

          <div className="app-topnav-divider" aria-hidden="true" />

          {/* Sign out */}
          <button
            className="bs-btn bs-btn-dark"
            type="button"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="app-body-wrap">
        {/* Main content area */}
        <div className="app-main-area">
          <main className="app-main">
            {route.kind === "document" ? (
              <DocumentDetail
                owner={route.owner}
                repo={route.repo}
                uploaderSlug={user?.username ?? "unknown"}
                activeView={route.tab}
                onTabChange={(tab) =>
                  onNavigate({
                    kind: "document",
                    owner: route.owner,
                    repo: route.repo,
                    tab,
                  })
                }
                onBack={() => onNavigate({ kind: "workspace" })}
              />
            ) : route.kind === "inbox" ? (
              <InboxPage
                currentUsername={user?.username ?? ""}
                onSelectDocument={(owner, repo) =>
                  onNavigate({
                    kind: "document",
                    owner,
                    repo,
                    tab: "overview",
                  })
                }
              />
            ) : route.kind === "activity" ? (
              <ActivityLogPage />
            ) : (
              <FileVaultWorkspace
                currentUsername={user?.username ?? ""}
                onSelectDocument={(owner, repo) =>
                  onNavigate({
                    kind: "document",
                    owner,
                    repo,
                    tab: "overview",
                  })
                }
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
