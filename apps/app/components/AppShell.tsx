import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  FileText,
  LogOut,
  Moon,
  Plus,
  Search,
  Shield,
} from "lucide-react";
import type { SessionUser } from "../api";
import type { AppRoute } from "../routes";
import { ActivityLogPage } from "./ActivityLogPage";
import { AdminSubscriptionManagementPage } from "./AdminSubscriptionManagementPage";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { DocumentDetail } from "./DocumentDetail";
import { DocumentsPage } from "./DocumentsPage";
import { HomePage } from "./HomePage";

interface AppShellProps {
  user: SessionUser | null;
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
    case "documents":
      return <FileText size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "appearance":
      return <Moon size={16} strokeWidth={1.5} aria-hidden="true" />;
    case "admin":
      return <Shield size={16} strokeWidth={1.5} aria-hidden="true" />;
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
  const isAdminSubscriptions = route.kind === "adminSubscriptions";

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
        {/* Brand — always the way back to Home */}
        <button
          type="button"
          className="app-topnav-brand"
          onClick={() => onNavigate({ kind: "workspace" })}
          aria-label="Bindersnap home"
        >
          <span className="app-topnav-logo-mark" aria-hidden="true">
            <BindersnapLogoMark width={14} height={14} aria-hidden="true" />
          </span>
          <span className="app-topnav-wordmark">Bindersnap</span>
        </button>

        {/* Two places to be. Changes are not one of them — they live on Home. */}
        <nav className="app-topnav-nav" aria-label="Workspace">
          <button
            type="button"
            className={`app-topnav-link${isWorkspace ? " app-topnav-link--active" : ""}`}
            onClick={() => onNavigate({ kind: "workspace" })}
            aria-current={isWorkspace ? "page" : undefined}
          >
            Home
          </button>
          <button
            type="button"
            className={`app-topnav-link${isDocuments ? " app-topnav-link--active" : ""}`}
            onClick={() => onNavigate({ kind: "documents" })}
            aria-current={isDocuments ? "page" : undefined}
          >
            Documents
          </button>
        </nav>

        <div className="app-topnav-spacer" />

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
              placeholder="Search documents"
              aria-label="Search documents"
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
            New document
          </button>

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
              aria-label={`User: ${user?.username}`}
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
                    {user?.isAdmin ? (
                      <button
                        type="button"
                        className={`app-profile-menu-item${isAdminSubscriptions ? " app-profile-menu-item--active" : ""}`}
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          onNavigate({ kind: "adminSubscriptions" });
                        }}
                      >
                        <span className="app-profile-menu-icon">
                          {renderProfileMenuIcon("admin")}
                        </span>
                        <span className="app-profile-menu-label">
                          Pro Access
                        </span>
                      </button>
                    ) : null}
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
                activeChangeNumber={route.changeNumber ?? null}
                activeChangeView={route.changeView ?? "discussion"}
                onTabChange={(tab) =>
                  onNavigate({
                    kind: "document",
                    owner: route.owner,
                    repo: route.repo,
                    tab,
                  })
                }
                onOpenChange={(pullNumber, changeView) =>
                  onNavigate({
                    kind: "document",
                    owner: route.owner,
                    repo: route.repo,
                    tab: "changes",
                    ...(pullNumber === null
                      ? {}
                      : {
                          changeNumber: pullNumber,
                          changeView: changeView ?? "discussion",
                        }),
                  })
                }
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
              />
            ) : route.kind === "activity" ? (
              <ActivityLogPage />
            ) : route.kind === "adminSubscriptions" ? (
              <AdminSubscriptionManagementPage
                currentUsername={currentUsername}
              />
            ) : (
              <HomePage
                currentUsername={currentUsername}
                currentUserFullName={user?.fullName ?? ""}
                onOpenChange={(owner, repo, changeNumber) =>
                  onNavigate({
                    kind: "document",
                    owner,
                    repo,
                    tab: "changes",
                    changeNumber,
                    changeView: "discussion",
                  })
                }
                onBrowseDocuments={() => onNavigate({ kind: "documents" })}
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
