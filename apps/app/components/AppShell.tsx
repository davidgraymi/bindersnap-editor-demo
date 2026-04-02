import { useCallback, useEffect, useState } from "react";

import type { CommitSummary } from "../../../packages/gitea-client/documents";

const appEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const devDefaultApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:${
  appEnv?.BUN_PUBLIC_API_PORT ?? appEnv?.API_PORT ?? "8787"
}`;
const API_BASE_URL = (
  appEnv?.BUN_PUBLIC_API_BASE_URL ??
  appEnv?.BUN_PUBLIC_API_URL ??
  appEnv?.VITE_API_URL ??
  (isLocalHost ? devDefaultApiBaseUrl : "")
).replace(/\/$/, "");

interface AppShellProps {
  user: {
    username: string;
    fullName?: string;
  } | null;
  onSignOut: () => void | Promise<void>;
}

interface DocumentRow {
  title: string;
  path: string;
  latestCommit: CommitSummary | null;
}

interface DocumentsPayload {
  repository: string;
  documents: DocumentRow[];
}

function formatTimestamp(value: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function resolveApiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    if (typeof (payload as { error?: unknown }).error === "string") {
      return (payload as { error: string }).error;
    }

    if (typeof (payload as { message?: unknown }).message === "string") {
      return (payload as { message: string }).message;
    }
  }

  return fallback;
}

function parseDocuments(payload: unknown): DocumentsPayload {
  const rows =
    Array.isArray(payload)
      ? payload
      : typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { documents?: unknown }).documents)
        ? ((payload as { documents: unknown[] }).documents as unknown[])
        : [];
  const repository =
    typeof payload === "object" && payload !== null && typeof (payload as { repository?: unknown }).repository === "string"
      ? (payload as { repository: string }).repository
      : "your workspace";

  const documents = rows.flatMap((row) => {
    if (typeof row !== "object" || row === null) {
      return [];
    }

    const candidate = row as {
      title?: unknown;
      path?: unknown;
      latestCommit?: unknown;
      latest_commit?: unknown;
    };

    if (typeof candidate.title !== "string" || typeof candidate.path !== "string") {
      return [];
    }

    const latestCommit =
      typeof candidate.latestCommit === "object" && candidate.latestCommit !== null
        ? (candidate.latestCommit as CommitSummary)
        : typeof candidate.latest_commit === "object" && candidate.latest_commit !== null
          ? (candidate.latest_commit as CommitSummary)
        : null;

    return [
      {
        title: candidate.title,
        path: candidate.path,
        latestCommit,
      },
    ];
  });

  return { repository, documents };
}

async function fetchDocuments(): Promise<DocumentsPayload> {
  const response = await fetch(resolveApiUrl("/api/app/documents"), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, "Unable to load workspace documents."));
  }

  return parseDocuments(payload);
}

export function AppShell({ user, onSignOut }: AppShellProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [repository, setRepository] = useState("your workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = await fetchDocuments();
      setDocuments(payload.documents);
      setRepository(payload.repository);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace documents.";

      setError(message);
      setDocuments([]);
      setRepository("your workspace");
    } finally {
      setLoading(false);
    }
  }, []);

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
          <div>
            <div className="app-logo-text">Bindersnap</div>
            <div className="app-doc-path">Signed in as {user?.fullName ?? user?.username ?? "Unknown"}</div>
          </div>
        </div>

        <div className="app-topbar-actions">
          <button className="bs-btn bs-btn-secondary" type="button" onClick={() => void loadDocuments()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="bs-btn bs-btn-dark" type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="bs-card app-summary">
          <div className="bs-eyebrow">Workspace</div>
          <h1>{repository}</h1>
          <p>
            Signed in as {user?.fullName ?? user?.username ?? "your account"}. Documents load through the
            Bindersnap session API, not from a browser-held upstream token.
          </p>
        </section>

        {error ? (
          <section className="bs-card app-error">
            <div className="bs-eyebrow">Failure State</div>
            <h2>Could not fetch workspace documents.</h2>
            <p>{error}</p>
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
              <div className="bs-card app-doc-empty">No documents were returned for this workspace.</div>
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
