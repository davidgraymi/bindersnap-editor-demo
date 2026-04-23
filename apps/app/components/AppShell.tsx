import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  FileText,
  GitPullRequest,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  User,
} from "lucide-react";
import type { AppRoute } from "../routes";
import { ActivityLogPage } from "./ActivityLogPage";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { DocumentDetail } from "./DocumentDetail";
import { DocumentsPage } from "./DocumentsPage";
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

function formatDocumentName(repoName: string): string {
  return repoName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getTopnavTitle(route: AppRoute): ReactNode {
  switch (route.kind) {
    case "workspace":
      return "Home";
    case "documents":
      return "Documents";
    case "inbox":
      return "Inbox";
    case "activity":
      return "Activity";
    case "document":
      return (
        <>
          {route.owner} / <strong>{formatDocumentName(route.repo)}</strong>
        </>
      );
    default:
      return "Bindersnap";
  }
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
      return <User size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "documents":
      return <FileText size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "settings":
      return <Settings size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "appearance":
      return <Moon size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "signout":
      return <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />;
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
  const isWorkspace = route.kind === "workspace";
  const isDocuments = route.kind === "documents" || route.kind === "document";
  const isInbox = route.kind === "inbox";
  const topnavTitle = getTopnavTitle(route);

  const displayName = user?.fullName ?? user?.username ?? "";
  const username = user?.username ?? displayName;
  const currentUsername = user?.username ?? "";
  const initials = displayName ? getInitials(displayName) : "?";

  const [profileOpen, setProfileOpen] = useState(false);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);

  const openCreateDocumentModal = useCallback(() => {
    setShowCreateDocumentModal(true);
  }, []);

  useEffect(() => {
    document.addEventListener("bs:open-create-modal", openCreateDocumentModal);
    return () => {
      document.removeEventListener(
        "bs:open-create-modal",
        openCreateDocumentModal,
      );
    };
  }, [openCreateDocumentModal]);

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
            <BindersnapLogoMark
              width={14}
              height={14}
              style={{ color: "white" }}
              aria-hidden="true"
            />
          </button>
          <span>{topnavTitle}</span>
        </div>

        {/* Spacer — pushes all right-side items to the far right */}
        <div className="app-topnav-spacer" />

        {/* Right side — order: search, create doc, change requests, documents, notifications, profile */}
        <div className="app-topnav-right">
          {/* Search */}
          <div className="app-nav-search" role="search">
            <Search
              className="app-nav-search-icon"
              aria-hidden="true"
              size={14}
              strokeWidth={1.5}
            />
            <input
              className="app-nav-search-input"
              type="text"
              placeholder="Type / to search"
              aria-label="Type / to search"
            />
            <span className="app-nav-search-kbd" aria-hidden="true">
              /
            </span>
          </div>

          {/* Create document */}
          <button
            className="app-topnav-new-btn"
            type="button"
            id="topnav-new-doc-btn"
            onClick={openCreateDocumentModal}
          >
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
            New Document
          </button>

          {/* Change Requests */}
          <button
            type="button"
            className={`app-topnav-link${isInbox ? " app-topnav-link--active" : ""}`}
            onClick={() => onNavigate({ kind: "inbox" })}
          >
            <GitPullRequest size={14} strokeWidth={1.5} aria-hidden="true" />
            Changes
          </button>

          {/* Documents */}
          <button
            type="button"
            className={`app-topnav-link${isDocuments ? " app-topnav-link--active" : ""}`}
            onClick={() => onNavigate({ kind: "documents" })}
          >
            <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
            Documents
          </button>

          <div className="app-topnav-divider" aria-hidden="true" />

          {/* Notifications */}
          <button
            className="app-topnav-icon-btn"
            type="button"
            aria-label="Notifications"
          >
            <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
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
                      className={`app-profile-menu-item${isDocuments ? " app-profile-menu-item--active" : ""}`}
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        onNavigate({ kind: "documents" });
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
          <main
            className={`app-main${isWorkspace ? " app-main--workspace" : " app-main--page"}`}
          >
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
            ) : route.kind === "documents" ? (
              <DocumentsPage
                currentUsername={currentUsername}
                onSelectDocument={(owner, repo) =>
                  onNavigate({
                    kind: "document",
                    owner,
                    repo,
                    tab: "overview",
                  })
                }
                onNewDocument={openCreateDocumentModal}
              />
            ) : route.kind === "inbox" ? (
              <InboxPage
                currentUsername={currentUsername}
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
                currentUsername={currentUsername}
                onSelectDocument={(owner, repo) =>
                  onNavigate({
                    kind: "document",
                    owner,
                    repo,
                    tab: "overview",
                  })
                }
                onNewDocument={openCreateDocumentModal}
              />
            )}
          </main>
        </div>
      </div>

      {showCreateDocumentModal ? (
        <CreateDocumentModal
          owner={currentUsername}
          onClose={() => setShowCreateDocumentModal(false)}
          onSuccess={(owner, repo) => {
            setShowCreateDocumentModal(false);
            onNavigate({
              kind: "document",
              owner,
              repo,
              tab: "overview",
            });
          }}
        />
      ) : null}
    </div>
  );
}
