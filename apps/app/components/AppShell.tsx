import type { AppRoute } from "../App";
import { DocumentDetail } from "./DocumentDetail";
import { FileVaultWorkspace } from "./FileVaultWorkspace";

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

export function AppShell({
  user,
  route,
  onNavigate,
  onSignOut,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-logo-wrap">
          <div className="app-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none">
              <rect
                x="2"
                y="1"
                width="9"
                height="13"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="6"
                y="4"
                width="9"
                height="13"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </div>
          <div className="app-logo-text">Bindersnap</div>
        </div>

        {route.kind === "document" ? (
          <nav className="app-topbar-breadcrumb" aria-label="Breadcrumb">
            <button
              className="app-breadcrumb-back"
              type="button"
              onClick={() => onNavigate({ kind: "workspace" })}
            >
              Workspace
            </button>
            <span className="app-breadcrumb-sep" aria-hidden="true">›</span>
            <span className="app-breadcrumb-current">
              {route.repo
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")}
            </span>
          </nav>
        ) : null}

        <div className="app-topbar-actions">
          {user ? (
            <span className="app-user-badge">
              {user.fullName ?? user.username}
            </span>
          ) : null}
          <button
            className="bs-theme-toggle"
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
          <button
            className="bs-btn bs-btn-dark"
            type="button"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      </header>

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
        ) : (
          <FileVaultWorkspace
            currentUsername={user?.username ?? ""}
            onSelectDocument={(owner, repo) =>
              onNavigate({ kind: "document", owner, repo, tab: "overview" })
            }
          />
        )}
      </main>
    </div>
  );
}
