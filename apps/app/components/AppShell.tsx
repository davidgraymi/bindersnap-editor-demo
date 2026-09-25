import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useIsReadOnly } from "../readOnlyContext";
import { CreditCard, LogOut, Moon, Shield } from "lucide-react";
import type { SessionUser } from "../api";
import { buildDocumentsUrl, parseDocumentsViewState } from "../documentsView";
import { followInApp, navigateToHref } from "../appLink";
import { routeToPath, type AppRoute } from "../routes";
import { BinderShell } from "./BinderShell";
import { OrganizationPage } from "./OrganizationPage";
import { LocationTrail } from "./LocationTrail";
import { useWriteAction } from "../paywallContext";
import { AdminSubscriptionManagementPage } from "./AdminSubscriptionManagementPage";
import { AppIcon } from "./AppIcon";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { DocumentsPage } from "./DocumentsPage";
import { ReviewQueuePage } from "./ReviewQueuePage";
import { AppSidebar, type SidebarBinder } from "./AppSidebar";
import { BinderExplorer } from "./BinderExplorer";
import { AppBottomNav } from "./AppBottomNav";
import { useDefaultOrganization } from "../useOrganizationDisplayName";
import { HomePage } from "./HomePage";
import { NavSearch } from "./NavSearch";
import { CreateMenu } from "./CreateMenu";

interface AppShellProps {
  user: SessionUser | null;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
  onSignOut: () => void | Promise<void>;
  /**
   * The billing page, built by the app that holds the billing state. Drawn in
   * the shell like any other settings page, rather than in place of it.
   */
  billing?: ReactNode;
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
    buildDocumentsUrl({ binder: null, freeText }),
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
    case "billing":
      return <AppIcon icon={CreditCard} size="md" />;
    case "appearance":
      return <AppIcon icon={Moon} size="md" />;
    case "admin":
      return <AppIcon icon={Shield} size="md" />;
    case "signout":
      return <AppIcon icon={LogOut} size="md" />;
    default:
      return null;
  }
}

export function AppShell({
  user,
  route,
  onNavigate,
  onSignOut,
  billing = null,
}: AppShellProps) {
  const isReadOnly = useIsReadOnly();
  const isWorkspace = route.kind === "workspace";
  const isBilling = route.kind === "billing";

  // The organization the sidebar's org-scoped entries point at: the one on
  // screen, or the one the switcher settled on. Null on a page that belongs to
  // no organization and before the switcher has answered — those entries go
  // inert rather than guessing.
  const defaultOrg = useDefaultOrganization();
  const sidebarOrg =
    route.kind === "organization" ||
    route.kind === "binder" ||
    route.kind === "binderDocument"
      ? route.org
      : defaultOrg;
  const isAdminSubscriptions = route.kind === "adminSubscriptions";

  const displayName = user?.fullName ?? user?.username ?? "";
  const username = user?.username ?? displayName;
  const currentUsername = user?.username ?? "";
  const initials = displayName ? getInitials(displayName) : "?";

  /**
   * The binder on screen, for the sidebar's own section of it.
   *
   * Reported up by the shell that is already reading the binder rather than
   * fetched again here: the sidebar needs its name, its open-change count and
   * which of its screens is open, and all three are things `BinderShell` knows
   * a moment after it loads.
   */
  const [sidebarBinder, setSidebarBinder] = useState<SidebarBinder | null>(
    null,
  );
  /**
   * The `org/binder` of an address that turned out to name no binder, so the
   * top bar does not go on naming it. Kept by address rather than cleared on
   * navigation: any other binder simply is not this one.
   */
  const [missingBinder, setMissingBinder] = useState<string | null>(null);
  const onBinderMissing = useCallback(
    (missing: boolean) => {
      if (route.kind !== "binder" && route.kind !== "binderDocument") return;
      const key = `${route.org}/${route.binder}`;
      setMissingBinder((current) =>
        missing ? key : current === key ? null : current,
      );
    },
    [route],
  );
  const [profileOpen, setProfileOpen] = useState(false);
  // A search that was linked to or reloaded is still the search that is on
  // screen, so the box says so.
  const [initialSearch] = useState(
    () => parseDocumentsViewState(window.location.search).freeText,
  );

  // A binder is a write, so it meets the paywall while the organization
  // cannot write. An organization is free to make: the first has a trial.
  const newBinder = useWriteAction((org: string) =>
    navigateToHref(`/${org}?new=binder`),
  );

  // Leaving a binder takes its section with it, so the map does not keep
  // offering the screens of a binder you are no longer in.
  useEffect(() => {
    if (route.kind !== "binder" && route.kind !== "binderDocument") {
      setSidebarBinder(null);
    }
  }, [route]);

  return (
    <div className="app-shell">
      {/* ── TOP NAV ── */}
      <header className="app-topnav">
        {/* Brand — always the way back to Home, and a real link to it. */}
        <a
          className="app-topnav-brand"
          href={routeToPath({ kind: "workspace" })}
          onClick={(event) =>
            followInApp(event, () => onNavigate({ kind: "workspace" }))
          }
          aria-label="Bindersnap home"
        >
          <span className="app-topnav-logo-mark" aria-hidden="true">
            <BindersnapLogoMark width={14} height={14} aria-hidden="true" />
          </span>
          <span className="app-topnav-wordmark">Bindersnap</span>
        </a>

        {/* **Which organization and binder you are in**, on every page —
            GitHub's owner / repo. Where inside the binder is drawn above the
            page's title instead (`PagePath`), inside the content. The
            organization is the switcher it always was. */}
        <LocationTrail
          route={route}
          org={sidebarOrg}
          binderMissing={
            (route.kind === "binder" || route.kind === "binderDocument") &&
            missingBinder === `${route.org}/${route.binder}`
          }
          onNavigate={onNavigate}
        />

        <div className="app-topnav-spacer" />

        <div className="app-topnav-right">
          {/* Search — the only search there is, on every page */}
          <NavSearch
            currentUsername={currentUsername}
            org={sidebarOrg}
            initialQuery={initialSearch}
            onNavigate={onNavigate}
            onSearchLibrary={navigateToSearch}
          />

          {/* Make something that has no page to be added from: a binder, an
              organization. A document is added on its binder's page. */}
          <CreateMenu
            org={sidebarOrg}
            onNewBinder={newBinder}
            onNewOrganization={() => onNavigate({ kind: "createOrganization" })}
          />

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
                    {/* Billing, not a second way to Documents. The sidebar
                        already goes to Documents; on a phone the sidebar is
                        not drawn and the bottom bar carries only the four
                        places people move between, so this menu is the one
                        way to reach Billing there. */}
                    <button
                      type="button"
                      className={`app-profile-menu-item${isBilling ? " app-profile-menu-item--active" : ""}`}
                      role="menuitem"
                      onClick={() => {
                        setProfileOpen(false);
                        onNavigate({ kind: "billing" });
                      }}
                    >
                      <span className="app-profile-menu-icon">
                        {renderProfileMenuIcon("billing")}
                      </span>
                      <span className="app-profile-menu-label">Billing</span>
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
        {/* The map of the product. Hidden below 768px, where the top bar's own
            links take over — see AppSidebar. */}
        <AppSidebar
          route={route}
          org={sidebarOrg}
          binder={sidebarBinder}
          currentUsername={currentUsername}
          currentUserFullName={user?.fullName ?? ""}
          onNavigate={onNavigate}
        />

        {/* The sheet the content sits on — see `.app-canvas`. The binder's
            files are content, so they are on it; the sidebar is not. */}
        <div className="app-canvas">
          {/* **The binder's files, in a panel of their own.** Two different
            questions deserve two panels: the map of the product barely
            changes, and a binder's contents change every time you open a
            different binder. It also lets the file list be as wide as a
            filename needs while the map stays narrow. Only while a policy is
            open — every other binder screen draws its own tree in the page. */}
          {sidebarBinder?.contents ? (
            <BinderExplorer
              binder={{ ...sidebarBinder, contents: sidebarBinder.contents }}
              onNavigate={onNavigate}
            />
          ) : null}

          {/* Main content area */}
          <div className="app-main-area">
            <main
              className={`app-main${isWorkspace ? " app-main--workspace" : " app-main--page"}`}
            >
              {route.kind === "changes" ? (
                <ReviewQueuePage
                  currentUsername={currentUsername}
                  onOpenChange={(org, binder, change) =>
                    onNavigate({
                      kind: "binder",
                      org,
                      binder,
                      tab: "changes",
                      change,
                    })
                  }
                  onBrowseDocuments={() => onNavigate({ kind: "documents" })}
                />
              ) : route.kind === "documents" ? (
                <DocumentsPage
                  onSelectDocument={(org, binder, documentPath) =>
                    onNavigate({
                      kind: "binderDocument",
                      org,
                      binder,
                      documentPath,
                    })
                  }
                  onOpenBinder={(org, binder) =>
                    onNavigate({ kind: "binder", org, binder })
                  }
                />
              ) : route.kind === "organization" ? (
                <OrganizationPage
                  org={route.org}
                  onOpenBinder={(binder) =>
                    onNavigate({ kind: "binder", org: route.org, binder })
                  }
                />
              ) : route.kind === "binder" || route.kind === "binderDocument" ? (
                // One shell for both: a document is a file inside the binder,
                // so it opens under the binder's own header and tabs rather
                // than on a page of its own.
                <BinderShell
                  org={route.org}
                  binder={route.binder}
                  {...(route.kind === "binderDocument"
                    ? { documentPath: route.documentPath }
                    : {})}
                  currentUser={currentUsername}
                  onBinderChange={setSidebarBinder}
                  onBinderMissing={onBinderMissing}
                  onOpenDocument={(documentPath, version) =>
                    onNavigate({
                      kind: "binderDocument",
                      org: route.org,
                      binder: route.binder,
                      documentPath,
                      ...(version == null ? {} : { version }),
                    })
                  }
                  onOpenBinder={() =>
                    onNavigate({
                      kind: "binder",
                      org: route.org,
                      binder: route.binder,
                    })
                  }
                />
              ) : route.kind === "billing" ? (
                billing
              ) : route.kind === "adminSubscriptions" ? (
                <AdminSubscriptionManagementPage
                  currentUsername={currentUsername}
                />
              ) : (
                <HomePage
                  currentUsername={currentUsername}
                  currentUserFullName={user?.fullName ?? ""}
                  // A change is on a binder now: Home's rows carry the owning
                  // organization and the binder, which is what `owner`/`repo`
                  // always were once a document stopped being a repository.
                  onOpenChange={(org, binder, changeNumber) =>
                    onNavigate({
                      kind: "binder",
                      org,
                      binder,
                      tab: "changes",
                      change: changeNumber,
                    })
                  }
                  onBrowseDocuments={() => onNavigate({ kind: "documents" })}
                  onOpenBinders={
                    sidebarOrg
                      ? () =>
                          onNavigate({ kind: "organization", org: sidebarOrg })
                      : null
                  }
                />
              )}
            </main>
          </div>
        </div>
      </div>

      {/* Below 768px the sidebar is not rendered and this is the navigation.
          Fixed to the bottom, so it sits outside the scrolling body. */}
      <AppBottomNav route={route} org={sidebarOrg} onNavigate={onNavigate} />
    </div>
  );
}
