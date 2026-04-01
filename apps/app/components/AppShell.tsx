import { useCallback, useEffect, useMemo, useState } from "react";

import { createGiteaClient, GiteaApiError } from "../../../packages/gitea-client/client";
import { listDocumentCommits, type CommitSummary } from "../../../packages/gitea-client/documents";

interface AppShellProps {
  baseUrl: string;
  token: string;
  onSignOut: () => void;
}

interface DocumentRow {
  title: string;
  path: string;
  latestCommit: CommitSummary | null;
}

const SEEDED_DOCUMENTS: Array<Pick<DocumentRow, "title" | "path">> = [
  { title: "Draft", path: "documents/draft.json" },
  { title: "In Review", path: "documents/in-review.json" },
  { title: "Changes Requested", path: "documents/changes-requested.json" },
];

function formatTimestamp(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function maskToken(value: string) {
  if (value.length <= 8) {
    return "********";
  }

  return `***${value.slice(-8)}`;
}

export function AppShell({ baseUrl, token, onSignOut }: AppShellProps) {
  const client = useMemo(() => createGiteaClient(baseUrl, token), [baseUrl, token]);

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextRows = await Promise.all(
        SEEDED_DOCUMENTS.map(async (doc) => {
          const commits = await listDocumentCommits({
            client,
            owner: "alice",
            repo: "quarterly-report",
            filePath: doc.path,
            limit: 1,
          });

          return {
            ...doc,
            latestCommit: commits[0] ?? null,
          };
        }),
      );

      setDocuments(nextRows);
    } catch (loadError) {
      const message =
        loadError instanceof GiteaApiError
          ? loadError.message
          : loadError instanceof Error
            ? loadError.message
            : "Unable to load documents from Gitea.";

      setError(message);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

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
          <button className="bs-btn bs-btn-secondary" type="button" onClick={() => void loadDocuments()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="bs-btn bs-btn-dark" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="bs-card app-summary">
          <div className="bs-eyebrow">Seeded Repository</div>
          <h1>alice/quarterly-report</h1>
          <p>Documents are loaded from commit history using <code>listDocumentCommits</code>.</p>
        </section>

        {error ? (
          <section className="bs-card app-error">
            <div className="bs-eyebrow">Failure State</div>
            <h2>Could not fetch Gitea documents.</h2>
            <p>{error}</p>
            <dl>
              <div>
                <dt>Gitea URL</dt>
                <dd>{baseUrl}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{maskToken(token)}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="app-docs">
          <div className="app-section-heading">
            <div className="bs-eyebrow">Documents</div>
            <h2>Local dev seed documents</h2>
          </div>

          <div className="app-doc-grid">
            {loading ? <div className="bs-card app-doc-empty">Loading documents...</div> : null}
            {!loading && documents.length === 0 ? (
              <div className="bs-card app-doc-empty">No documents found in the seeded repository.</div>
            ) : null}
            {documents.map((doc) => (
              <article className="bs-card app-doc-card" key={doc.path}>
                <h3>{doc.title}</h3>
                <p className="app-doc-path">{doc.path}</p>
                <dl>
                  <div>
                    <dt>Latest Commit</dt>
                    <dd>{doc.latestCommit?.sha ? doc.latestCommit.sha.slice(0, 7) : "None"}</dd>
                  </div>
                  <div>
                    <dt>Message</dt>
                    <dd>{doc.latestCommit?.message ?? "No commit found"}</dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>{doc.latestCommit?.author ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Timestamp</dt>
                    <dd>{formatTimestamp(doc.latestCommit?.timestamp ?? "")}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
