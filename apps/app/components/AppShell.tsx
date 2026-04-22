import { useState } from "react";
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

function renderProfileMenuIcon(icon: string) {
  switch (icon) {
    case "profile":
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="8" cy="5.25" r="2.25" />
          <path d="M3.5 13.25a4.5 4.5 0 0 1 9 0" />
        </svg>
      );
    case "documents":
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4.25 2.75h4.5l3 3v7.5H4.25z" />
          <path d="M8.75 2.75v3h3" />
        </svg>
      );
    case "settings":
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="2.25" />
          <path d="M8 2.5v1.25M8 12.25v1.25M12.25 8h1.25M2.5 8h1.25M11.9 4.1l-.9.9M5 11l-.9.9M11.9 11.9l-.9-.9M5 5l-.9-.9" />
        </svg>
      );
    case "appearance":
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M8 2.25a5.75 5.75 0 1 0 5.75 5.75A4.75 4.75 0 0 1 8 2.25Z" />
        </svg>
      );
    case "signout":
      return (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M6 2.75H4.5A1.75 1.75 0 0 0 2.75 4.5v7A1.75 1.75 0 0 0 4.5 13.25H6" />
          <path d="M8.5 5.25 11.5 8l-3 2.75" />
          <path d="M11.5 8h-6" />
        </svg>
      );
    default:
      return null;
  }
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
  const username = user?.username ?? displayName;
  const initials = displayName ? getInitials(displayName) : "?";

  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="app-shell">
      {/* ── TOP NAV ── */}
      <header className="app-topnav">
        {/* Logo mark (always navigates to Dashboard) + page title */}
        <div className="app-topnav-logo">
          <button
            type="button"
            className="app-topnav-logo-mark"
            onClick={() => onNavigate({ kind: "workspace" })}
            aria-label="Go to Dashboard"
          >
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
          </button>
          <span>
            {isDocumentRoute ? `${route.owner} / ${route.repo}` : "Dashboard"}
          </span>
        </div>

        {/* Spacer — pushes all right-side items to the far right */}
        <div className="app-topnav-spacer" />

        {/* Right side — order: search, create doc, change requests, documents, notifications, profile */}
        <div className="app-topnav-right">
          {/* Search */}
          {!isDocumentRoute ? (
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
          ) : null}

          {/* Create document */}
          {!isDocumentRoute ? (
            <button
              className="app-topnav-new-btn"
              type="button"
              id="topnav-new-doc-btn"
              onClick={() => {
                document.dispatchEvent(new CustomEvent("bs:open-create-modal"));
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
          ) : null}

          {/* Change Requests */}
          {!isDocumentRoute ? (
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
          ) : null}

          {/* Documents */}
          {!isDocumentRoute ? (
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
                <path d="M3 4h10M3 8h10M3 12h6" />
              </svg>
              Documents
            </button>
          ) : null}

          <div className="app-topnav-divider" aria-hidden="true" />

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

          {/* User profile: avatar with dropdown */}
          <div className="app-topnav-profile">
            <button
              type="button"
              className="app-topnav-avatar"
              title={displayName || user?.username}
              aria-label={`User: ${displayName || user?.username}`}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              onClick={() => setProfileOpen((o) => !o)}
            >
              {initials}
            </button>

            {profileOpen && (
              <>
                <div
                  className="app-profile-backdrop"
                  onClick={() => setProfileOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className="app-profile-menu"
                  role="menu"
                  aria-label="Account menu"
                >
                  <div className="app-profile-menu-header">
                    <div className="app-profile-menu-identity">
                      <div
                        className="app-profile-menu-avatar"
                        aria-hidden="true"
                      >
                        {initials}
                      </div>
                      <div className="app-profile-menu-copy">
                        <p className="app-profile-menu-handle">{username}</p>
                      </div>
                    </div>
                  </div>

                  <div
                    className="app-profile-menu-section"
                    role="group"
                    aria-label="Navigation"
                  >
                    <button
                      type="button"
                      className="app-profile-menu-item app-profile-menu-item--disabled"
                      role="menuitem"
                      aria-disabled="true"
                      disabled
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("profile")}
                      </span>
                      <span className="app-profile-menu-label">Profile</span>
                    </button>
                    <button
                      type="button"
                      className={`app-profile-menu-item${isWorkspace ? " app-profile-menu-item--active" : ""}`}
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        onNavigate({ kind: "workspace" });
                      }}
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("documents")}
                      </span>
                      <span className="app-profile-menu-label">Documents</span>
                    </button>
                    <button
                      type="button"
                      className="app-profile-menu-item app-profile-menu-item--disabled"
                      role="menuitem"
                      aria-disabled="true"
                      disabled
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("settings")}
                      </span>
                      <span className="app-profile-menu-label">Settings</span>
                    </button>
                    <button
                      type="button"
                      className="app-profile-menu-item"
                      role="menuitem"
                      onClick={() => {
                        toggleTheme();
                        setProfileOpen(false);
                      }}
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("appearance")}
                      </span>
                      <span className="app-profile-menu-label">Appearance</span>
                    </button>
                  </div>

                  <div
                    className="app-profile-menu-section"
                    role="group"
                    aria-label="Session"
                  >
                    <button
                      type="button"
                      className="app-profile-menu-item app-profile-menu-item--danger"
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        void onSignOut();
                      }}
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("signout")}
                      </span>
                      <span className="app-profile-menu-label">Sign out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
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
