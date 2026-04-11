import type { GiteaClient } from "../../../packages/gitea-client/client";
import type { AppRoute } from "../App";
import { DocumentDetail } from "./DocumentDetail";
import { FileVaultWorkspace } from "./FileVaultWorkspace";

interface AppShellProps {
  user: {
    username: string;
    fullName?: string;
  } | null;
  giteaClient: GiteaClient;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
  onSignOut: () => void | Promise<void>;
}

export function AppShell({
  user,
  giteaClient,
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
          <div>
            <div className="app-logo-text">Bindersnap</div>
            <div className="app-doc-path">
              Signed in as {user?.fullName ?? user?.username ?? "Unknown"}
            </div>
          </div>
        </div>

        <div className="app-topbar-actions">
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
            giteaClient={giteaClient}
            owner={route.owner}
            repo={route.repo}
            uploaderSlug={user?.username ?? "unknown"}
            activeView={route.tab}
            onTabChange={(tab) =>
              onNavigate({ kind: "document", owner: route.owner, repo: route.repo, tab })
            }
            onBack={() => onNavigate({ kind: "workspace" })}
          />
        ) : (
          <FileVaultWorkspace
            giteaClient={giteaClient}
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
