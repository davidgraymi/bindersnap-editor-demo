import { useCallback, useEffect, useMemo, useState } from "react";

import { createGiteaClient, GiteaApiError } from "../../services/gitea/client";
import { commitDocument } from "../../services/gitea/documents";
import { DocumentEditor } from "./DocumentEditor";

interface AppShellProps {
  baseUrl: string;
  token: string;
  onSignOut: () => void;
}

interface RepoRow {
  owner: string;
  name: string;
  description: string;
  updatedAt: string;
  defaultBranch: string;
}

interface DocSelection {
  owner: string;
  repo: string;
  filePath: string;
  branch: string;
}

const DEFAULT_DOC_PATH = "document.json";
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function formatTimestamp(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function AppShell({ baseUrl, token, onSignOut }: AppShellProps) {
  const client = useMemo(() => createGiteaClient(baseUrl, token), [baseUrl, token]);

  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocSelection | null>(null);

  const loadRepos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await client.repos.repoSearch({
        limit: 50,
        sort: "updated",
        order: "desc",
      });

      setRepos(
        (response.data.data ?? []).map((repo) => ({
          owner: repo.owner?.login ?? "",
          name: repo.name ?? "",
          description: repo.description ?? "",
          updatedAt: repo.updated ?? "",
          defaultBranch: repo.default_branch ?? "main",
        }))
      );
    } catch (loadError) {
      const message =
        loadError instanceof GiteaApiError
          ? loadError.message
          : loadError instanceof Error
            ? loadError.message
            : "Unable to load repositories from Gitea.";
      setError(message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  const handleNewDocument = useCallback(async () => {
    const name = window.prompt("New document name (will create a new Gitea repo):");
    if (!name?.trim()) return;

    const repoName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    setCreating(true);

    try {
      // Create the repo
      await client.repos.createCurrentUserRepo({
        name: repoName,
        description: name.trim(),
        auto_init: true,
        default_branch: "main",
      });

      // Get the current user to know the owner
      const { data: user } = await client.user.userGetCurrent();
      const owner = user.login ?? "";

      // Create the initial document file
      await commitDocument({
        client,
        owner,
        repo: repoName,
        filePath: DEFAULT_DOC_PATH,
        branch: "main",
        content: EMPTY_DOC,
        message: "Initial document",
      });

      // Open the new document
      setOpenDoc({ owner, repo: repoName, filePath: DEFAULT_DOC_PATH, branch: "main" });
      void loadRepos();
    } catch (err) {
      const msg = err instanceof GiteaApiError ? err.message : err instanceof Error ? err.message : "Failed to create document.";
      window.alert(`Failed to create document: ${msg}`);
    } finally {
      setCreating(false);
    }
  }, [client, loadRepos]);

  // Show document editor if a doc is selected
  if (openDoc) {
    return (
      <DocumentEditor
        client={client}
        owner={openDoc.owner}
        repo={openDoc.repo}
        filePath={openDoc.filePath}
        branch={openDoc.branch}
        onBack={() => {
          setOpenDoc(null);
          void loadRepos();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-logo-wrap">
          <div className="app-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none">
              <rect x="2" y="1" width="9" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <rect x="6" y="4" width="9" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </div>
          <div className="app-logo-text">Bindersnap</div>
        </div>

        <div className="app-topbar-actions">
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={() => void loadRepos()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={() => void handleNewDocument()}
            disabled={creating}
          >
            {creating ? "Creating…" : "New Document"}
          </button>
          <button className="bs-btn bs-btn-dark" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        {error ? (
          <section className="bs-card app-error">
            <div className="bs-eyebrow">Error</div>
            <h2>Could not fetch repositories.</h2>
            <p>{error}</p>
          </section>
        ) : null}

        <section className="app-docs">
          <div className="app-section-heading">
            <div className="bs-eyebrow">Documents</div>
            <h2>Your workspaces</h2>
          </div>

          <div className="app-doc-grid">
            {loading ? <div className="bs-card app-doc-empty">Loading documents…</div> : null}
            {!loading && repos.length === 0 ? (
              <div className="bs-card app-doc-empty">No documents yet. Click "New Document" to create one.</div>
            ) : null}
            {repos.map((repo) => (
              <article className="bs-card app-doc-card" key={`${repo.owner}/${repo.name}`}>
                <h3>{repo.description || repo.name}</h3>
                <p className="app-doc-path">{repo.owner}/{repo.name}</p>
                <dl>
                  <div>
                    <dt>Last updated</dt>
                    <dd>{formatTimestamp(repo.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{repo.defaultBranch}</dd>
                  </div>
                </dl>
                <button
                  className="bs-btn bs-btn-primary"
                  type="button"
                  style={{ marginTop: "var(--brand-space-3)", width: "100%" }}
                  onClick={() =>
                    setOpenDoc({
                      owner: repo.owner,
                      repo: repo.name,
                      filePath: DEFAULT_DOC_PATH,
                      branch: repo.defaultBranch,
                    })
                  }
                >
                  Open
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
