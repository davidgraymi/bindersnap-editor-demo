import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, FileText, LogOut, Moon, Search, Shield } from "lucide-react";
import type { SessionUser } from "../api";
import { buildDocumentsUrl, parseDocumentsViewState } from "../documentsView";
import type { AppRoute } from "../routes";
import { ActivityLogPage } from "./ActivityLogPage";
import { AdminSubscriptionManagementPage } from "./AdminSubscriptionManagementPage";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { CreateDocumentModal } from "./CreateDocumentModal";
import { DocumentDetail } from "./DocumentDetail";
import { DocumentsPage } from "./DocumentsPage";
import { HomePage } from "./HomePage";
import { NewDocumentButton } from "./NewDocumentButton";

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

/**
 * Search lands on the library, because that is where a document is found.
 *
 * The nav owns the search box on every page, so it moves the address bar
 * directly rather than going through the route table — a route is a page, and
 * this is a page plus a question.
 */
function navigateToSearch(freeText: string): void {
  window.history.pushState(
    {},
    "",
    buildDocumentsUrl({ view: "contributing", people: [], freeText }),
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
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
  // A search that was linked to or reloaded is still the search that is on
  // screen, so the box says so.
  const [search, setSearch] = useState(
    () => parseDocumentsViewState(window.location.search, "").freeText,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // "/" puts the cursor in search from anywhere — unless the reader is already
  // typing somewhere, where a slash is just a slash.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

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
          {/* Search — the only search there is, on every page */}
          <form
            className="app-nav-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              searchInputRef.current?.blur();
              navigateToSearch(search.trim());
            }}
          >
            <Search
              className="app-nav-search-icon"
              aria-hidden="true"
              size={14}
              strokeWidth={1.5}
            />
            <input
              ref={searchInputRef}
              className="app-nav-search-input"
              type="text"
              placeholder="Search documents"
              aria-label="Search documents"
              value={search}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearch("");
                  searchInputRef.current?.blur();
                }
              }}
            />
            <span className="app-nav-search-kbd" aria-hidden="true">
              /
            </span>
          </form>

          {/* Create document — a convenience, not the page's headline action */}
          <NewDocumentButton onClick={openCreateDocumentModal} />

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
                activeVersion={route.version ?? null}
                onTabChange={(tab) =>
                  onNavigate({
                    kind: "document",
                    owner: route.owner,
                    repo: route.repo,
                    tab,
                    // A version lives on the Document tab; walking to another
                    // tab leaves it behind rather than carrying it along.
                    ...(tab === "overview" && route.version !== undefined
                      ? { version: route.version }
                      : {}),
                  })
                }
                onSelectVersion={(version) =>
                  onNavigate({
                    kind: "document",
                    owner: route.owner,
                    repo: route.repo,
                    tab: "overview",
                    ...(version === null ? {} : { version }),
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
