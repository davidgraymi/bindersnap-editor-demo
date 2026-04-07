import { useState } from "react";

import type { GiteaClient } from "../../../packages/gitea-client/client";
import { DocumentDetail } from "./DocumentDetail";
import { FileVaultWorkspace } from "./FileVaultWorkspace";

interface AppShellProps {
  user: {
    username: string;
    fullName?: string;
  } | null;
  giteaClient: GiteaClient;
  onSignOut: () => void | Promise<void>;
}

type AppView = "workspace" | "document";

interface DocumentSelection {
  owner: string;
  repo: string;
}

export function AppShell({ user, giteaClient, onSignOut }: AppShellProps) {
  const [view, setView] = useState<AppView>("workspace");
  const [selectedDocument, setSelectedDocument] =
    useState<DocumentSelection | null>(null);

  const handleSelectDocument = (owner: string, repo: string) => {
    setSelectedDocument({ owner, repo });
    setView("document");
  };

  const handleBackToWorkspace = () => {
    setView("workspace");
    setSelectedDocument(null);
  };

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
        {view === "workspace" ? (
          <FileVaultWorkspace
            giteaClient={giteaClient}
            currentUsername={user?.username ?? ""}
            onSelectDocument={handleSelectDocument}
          />
        ) : selectedDocument ? (
          <DocumentDetail
            giteaClient={giteaClient}
            owner={selectedDocument.owner}
            repo={selectedDocument.repo}
            uploaderSlug={user?.username ?? "unknown"}
            onBack={handleBackToWorkspace}
          />
        ) : null}
      </main>
    </div>
  );
}
