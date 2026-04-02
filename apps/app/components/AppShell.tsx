import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type ApprovalState = "none" | "working" | "in_review" | "changes_requested" | "approved" | "published";

interface AppShellProps {
  user: {
    username: string;
    fullName?: string;
  } | null;
  onSignOut: () => void | Promise<void>;
}

interface DocumentPendingPullRequest {
  number: number;
  title: string;
  state: ApprovalState;
  branch: string;
  updatedAt: string;
  htmlUrl: string | null;
}

interface DocumentVaultItem {
  id: string;
  title: string;
  displayName: string;
  path: string;
  repository: string;
  publishedVersion: CommitSummary | null;
  currentPublishedVersion: CommitSummary | null;
  latestPendingVersionStatus: ApprovalState | null;
  latestPendingPullRequest: DocumentPendingPullRequest | null;
  latestCommit: CommitSummary | null;
  lastActivityTimestamp: string;
  lastActivityAt: string;
}

interface DocumentsPayload {
  repository: string;
  documents: DocumentVaultItem[];
}

interface DocumentDetailPayload {
  repository: string;
  document: DocumentVaultItem;
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

    if (
      typeof (payload as { error?: unknown }).error === "object" &&
      (payload as { error?: unknown }).error !== null &&
      typeof ((payload as { error?: { message?: unknown } }).error?.message) === "string"
    ) {
      return (payload as { error: { message: string } }).error.message;
    }
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readCommitSummary(value: unknown): CommitSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const sha = typeof value.sha === "string" ? value.sha.trim() : "";
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const author = typeof value.author === "string" ? value.author.trim() : "";
  const timestamp = typeof value.timestamp === "string" ? value.timestamp.trim() : "";

  if (!sha && !message && !author && !timestamp) {
    return null;
  }

  return { sha, message, author, timestamp };
}

function readApprovalState(value: unknown): ApprovalState | null {
  if (
    value === "none" ||
    value === "working" ||
    value === "in_review" ||
    value === "changes_requested" ||
    value === "approved" ||
    value === "published"
  ) {
    return value;
  }

  return null;
}

function readPendingPullRequest(value: unknown): DocumentPendingPullRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const number = typeof value.number === "number" && Number.isFinite(value.number) ? value.number : 0;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const state = readApprovalState(value.state) ?? null;
  const branch = typeof value.branch === "string" ? value.branch.trim() : "";
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt.trim() : "";
  const htmlUrl = typeof value.htmlUrl === "string" && value.htmlUrl.trim() !== "" ? value.htmlUrl.trim() : null;

  if (!number && !title && !state && !branch && !updatedAt && !htmlUrl) {
    return null;
  }

  return {
    number,
    title,
    state: state ?? "none",
    branch,
    updatedAt,
    htmlUrl,
  };
}

function readDocument(value: unknown): DocumentVaultItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!path) {
    return null;
  }

  const displayName =
    typeof value.displayName === "string" && value.displayName.trim() !== ""
      ? value.displayName.trim()
      : typeof value.title === "string" && value.title.trim() !== ""
        ? value.title.trim()
        : path;

  const currentPublishedVersion =
    readCommitSummary(value.currentPublishedVersion) ??
    readCommitSummary(value.publishedVersion) ??
    readCommitSummary(value.latestCommit);
  const publishedVersion =
    readCommitSummary(value.publishedVersion) ?? currentPublishedVersion;
  const latestCommit = readCommitSummary(value.latestCommit) ?? currentPublishedVersion;
  const latestPendingPullRequest = readPendingPullRequest(value.latestPendingPullRequest);
  const latestPendingVersionStatus =
    readApprovalState(value.latestPendingVersionStatus) ?? latestPendingPullRequest?.state ?? null;
  const lastActivityTimestamp =
    typeof value.lastActivityTimestamp === "string" && value.lastActivityTimestamp.trim() !== ""
      ? value.lastActivityTimestamp.trim()
      : typeof value.lastActivityAt === "string" && value.lastActivityAt.trim() !== ""
        ? value.lastActivityAt.trim()
        : latestPendingPullRequest?.updatedAt ?? latestCommit?.timestamp ?? "";
  const lastActivityAt =
    typeof value.lastActivityAt === "string" && value.lastActivityAt.trim() !== ""
      ? value.lastActivityAt.trim()
      : lastActivityTimestamp;

  return {
    id: typeof value.id === "string" && value.id.trim() !== "" ? value.id.trim() : path,
    title: displayName,
    displayName,
    path,
    repository: typeof value.repository === "string" && value.repository.trim() !== "" ? value.repository.trim() : "your workspace",
    publishedVersion,
    currentPublishedVersion,
    latestPendingVersionStatus,
    latestPendingPullRequest,
    latestCommit,
    lastActivityTimestamp,
    lastActivityAt,
  };
}

function parseDocuments(payload: unknown): DocumentsPayload {
  const repository =
    isRecord(payload) && typeof payload.repository === "string" && payload.repository.trim() !== ""
      ? payload.repository.trim()
      : "your workspace";

  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.documents)
      ? payload.documents
      : isRecord(payload) && isRecord(payload.document)
        ? [payload.document]
        : [];

  const documents = rows.flatMap((row) => {
    const document = readDocument(row);
    return document ? [document] : [];
  });

  return { repository, documents };
}

function parseDocumentDetail(payload: unknown): DocumentDetailPayload {
  if (isRecord(payload) && isRecord(payload.document)) {
    const document = readDocument(payload.document);
    if (document) {
      return {
        repository:
          typeof payload.repository === "string" && payload.repository.trim() !== ""
            ? payload.repository.trim()
            : document.repository,
        document,
      };
    }
  }

  const { repository, documents } = parseDocuments(payload);
  const document = documents[0];
  if (!document) {
    throw new Error("Document details were not returned.");
  }

  return { repository, document };
}

function formatCommitSummary(commit: CommitSummary | null | undefined): string {
  if (!commit) {
    return "No published version";
  }

  const parts = [commit.sha ? commit.sha.slice(0, 7) : "No SHA"];
  if (commit.message) {
    parts.push(commit.message);
  }
  return parts.join(" - ");
}

function formatPendingState(state: ApprovalState | null | undefined): string {
  switch (state) {
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "in_review":
      return "In review";
    case "working":
      return "Working";
    default:
      return "No pending review";
  }
}

function approvalTone(state: ApprovalState | null | undefined): string {
  switch (state) {
    case "published":
    case "approved":
      return "good";
    case "changes_requested":
      return "alert";
    case "in_review":
    case "working":
      return "pending";
    default:
      return "idle";
  }
}

function pendingCountProxy(document: DocumentVaultItem | null): number {
  return document?.latestPendingPullRequest ? 1 : 0;
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

async function fetchDocumentDetail(documentId: string): Promise<DocumentDetailPayload> {
  const response = await fetch(resolveApiUrl(`/api/app/documents/${encodeURIComponent(documentId)}`), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, "Unable to load document details."));
  }

  return parseDocumentDetail(payload);
}

export function AppShell({ user, onSignOut }: AppShellProps) {
  const [documents, setDocuments] = useState<DocumentVaultItem[]>([]);
  const [repository, setRepository] = useState("your workspace");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detailDocument, setDetailDocument] = useState<DocumentVaultItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectedDocumentIdRef = useRef<string | null>(null);

  const selectedDocument = useMemo(() => {
    if (detailDocument && detailDocument.id === selectedDocumentId) {
      return detailDocument;
    }

    return documents.find((document) => document.id === selectedDocumentId) ?? null;
  }, [detailDocument, documents, selectedDocumentId]);

  const loadDocumentDetail = useCallback(async (documentId: string) => {
    setDetailLoading(true);
    setDetailError(null);

    try {
      const payload = await fetchDocumentDetail(documentId);
      setDetailDocument(payload.document);
      setRepository(payload.repository);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load document details.";
      setDetailError(message);
      setDetailDocument(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDetailError(null);

    try {
      const payload = await fetchDocuments();
      setDocuments(payload.documents);
      setRepository(payload.repository);

      const nextSelectedDocumentId =
        payload.documents.some((document) => document.id === selectedDocumentIdRef.current)
          ? selectedDocumentIdRef.current
          : payload.documents[0]?.id ?? null;

      setSelectedDocumentId(nextSelectedDocumentId);

      if (nextSelectedDocumentId) {
        void loadDocumentDetail(nextSelectedDocumentId);
      } else {
        setDetailDocument(null);
      }
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace documents.";

      setError(message);
      setDocuments([]);
      setRepository("your workspace");
      setSelectedDocumentId(null);
      setDetailDocument(null);
    } finally {
      setLoading(false);
    }
  }, [loadDocumentDetail]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    selectedDocumentIdRef.current = selectedDocumentId;
  }, [selectedDocumentId]);

  const totalPendingCount = documents.reduce(
    (count, document) => count + (document.latestPendingPullRequest ? 1 : 0),
    0,
  );
  const latestWorkspaceActivity = documents[0]?.lastActivityTimestamp || documents[0]?.lastActivityAt || "";

  return (
    <div className="app-shell app-vault-shell">
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
            {loading ? "Refreshing..." : "Refresh vault"}
          </button>
          <button className="bs-btn bs-btn-dark" type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main app-vault-main">
        <section className="bs-card app-summary app-vault-hero">
          <div className="bs-eyebrow">File Vault</div>
          <div className="app-vault-hero-head">
            <div>
              <h1>{repository}</h1>
              <p>
                Keep the published file, the pending review branch, and the audit trail in one place.
                No editor canvas required for the core workflow.
              </p>
            </div>
            <div className="app-vault-hero-note">
              <span className="app-status-badge app-status-badge--good">Live catalog</span>
              <span className="app-vault-hero-meta">Session-backed access</span>
            </div>
          </div>

          <div className="app-vault-stats">
            <div className="app-vault-stat">
              <span className="app-vault-stat-label">Documents</span>
              <strong>{documents.length}</strong>
            </div>
            <div className="app-vault-stat">
              <span className="app-vault-stat-label">Pending reviews</span>
              <strong>{totalPendingCount}</strong>
            </div>
            <div className="app-vault-stat">
              <span className="app-vault-stat-label">Latest activity</span>
              <strong>{formatTimestamp(latestWorkspaceActivity)}</strong>
            </div>
          </div>
        </section>

        {error ? (
          <section className="bs-card app-error">
            <div className="bs-eyebrow">Failure State</div>
            <h2>Could not load the vault.</h2>
            <p>{error}</p>
          </section>
        ) : null}

        <section className="app-vault-layout">
          <section className="bs-card app-vault-list-panel">
            <div className="app-section-heading app-vault-list-heading">
              <div>
                <div className="bs-eyebrow">Documents</div>
                <h2>Published files and reviewable versions</h2>
              </div>
              <div className="app-vault-list-meta">
                <span className="app-vault-list-count">{documents.length} records</span>
                <span className="app-vault-list-count">{totalPendingCount} pending</span>
              </div>
            </div>

            <div className="app-vault-list">
              {loading ? <div className="bs-card app-doc-empty">Loading documents...</div> : null}
              {!loading && documents.length === 0 ? (
                <div className="bs-card app-doc-empty">
                  No documents were returned for this workspace.
                </div>
              ) : null}

              {documents.map((document) => {
                const isSelected = document.id === selectedDocumentId;
                const pendingCount = pendingCountProxy(document);
                return (
                  <button
                    key={document.id}
                    className={`bs-card app-vault-item ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedDocumentId(document.id);
                      void loadDocumentDetail(document.id);
                    }}
                    aria-pressed={isSelected}
                  >
                    <div className="app-vault-item-head">
                      <div>
                        <h3>{document.title}</h3>
                        <p className="app-doc-path">{document.path}</p>
                      </div>
                      <span className={`app-status-badge app-status-badge--${approvalTone(document.latestPendingVersionStatus)}`}>
                        {formatPendingState(document.latestPendingVersionStatus)}
                      </span>
                    </div>

                    <dl className="app-vault-item-grid">
                      <div>
                        <dt>Published</dt>
                        <dd>{formatCommitSummary(document.currentPublishedVersion ?? document.publishedVersion ?? document.latestCommit)}</dd>
                      </div>
                      <div>
                        <dt>Pending proxy</dt>
                        <dd>{pendingCount > 0 ? `1 pending version` : "No pending versions"}</dd>
                      </div>
                      <div>
                        <dt>Latest activity</dt>
                        <dd>{formatTimestamp(document.lastActivityTimestamp || document.lastActivityAt)}</dd>
                      </div>
                    </dl>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="bs-card app-vault-detail-panel">
            {detailError ? (
              <div className="app-vault-detail-error">
                <div className="bs-eyebrow">Detail State</div>
                <h2>Could not load this document.</h2>
                <p>{detailError}</p>
              </div>
            ) : null}

            {!selectedDocument ? (
              <div className="app-vault-detail-empty">
                <div className="bs-eyebrow">Document Detail</div>
                <h2>Select a file to inspect its review trail.</h2>
                <p>
                  The detail pane shows the published version, the latest pending review branch, and a short timeline.
                </p>
              </div>
            ) : (
              <>
                <div className="app-vault-detail-head">
                  <div>
                    <div className="bs-eyebrow">Document Detail</div>
                    <h2>{selectedDocument.title}</h2>
                    <p className="app-doc-path">{selectedDocument.path}</p>
                  </div>
                  <div className="app-vault-detail-meta">
                    <span className={`app-status-badge app-status-badge--${approvalTone(selectedDocument.latestPendingVersionStatus)}`}>
                      {formatPendingState(selectedDocument.latestPendingVersionStatus)}
                    </span>
                    <span className="app-vault-hero-meta">
                      {pendingCountProxy(selectedDocument)} pending version proxy
                    </span>
                  </div>
                </div>

                <div className="app-vault-detail-stack">
                  <article className="app-vault-detail-block">
                    <div className="bs-eyebrow">Current Published Version</div>
                    <h3>{formatCommitSummary(selectedDocument.currentPublishedVersion ?? selectedDocument.publishedVersion ?? selectedDocument.latestCommit)}</h3>
                    <dl>
                      <div>
                        <dt>Author</dt>
                        <dd>{selectedDocument.currentPublishedVersion?.author ?? selectedDocument.latestCommit?.author ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt>Timestamp</dt>
                        <dd>{formatTimestamp(selectedDocument.currentPublishedVersion?.timestamp ?? selectedDocument.latestCommit?.timestamp ?? "")}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="app-vault-detail-block">
                    <div className="bs-eyebrow">Latest Pending Review</div>
                    {selectedDocument.latestPendingPullRequest ? (
                      <>
                        <h3>
                          #{selectedDocument.latestPendingPullRequest.number} {selectedDocument.latestPendingPullRequest.title || "Review request"}
                        </h3>
                        <dl>
                          <div>
                            <dt>State</dt>
                            <dd>{formatPendingState(selectedDocument.latestPendingPullRequest.state)}</dd>
                          </div>
                          <div>
                            <dt>Branch</dt>
                            <dd>{selectedDocument.latestPendingPullRequest.branch || "Unknown"}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatTimestamp(selectedDocument.latestPendingPullRequest.updatedAt)}</dd>
                          </div>
                        </dl>
                        {selectedDocument.latestPendingPullRequest.htmlUrl ? (
                          <a
                            className="app-detail-link"
                            href={selectedDocument.latestPendingPullRequest.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open review request
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <p className="app-vault-block-empty">No pending review versions are open for this document.</p>
                    )}
                  </article>

                  <article className="app-vault-detail-block">
                    <div className="bs-eyebrow">Version Timeline</div>
                    <ol className="app-vault-timeline">
                      <li>
                        <strong>Published record</strong>
                        <span>{formatCommitSummary(selectedDocument.currentPublishedVersion ?? selectedDocument.publishedVersion ?? selectedDocument.latestCommit)}</span>
                      </li>
                      <li>
                        <strong>Pending review</strong>
                        <span>
                          {selectedDocument.latestPendingPullRequest
                            ? `#${selectedDocument.latestPendingPullRequest.number} ${formatPendingState(selectedDocument.latestPendingPullRequest.state)}`
                            : "None open right now"}
                        </span>
                      </li>
                      <li>
                        <strong>Latest activity</strong>
                        <span>{formatTimestamp(selectedDocument.lastActivityTimestamp || selectedDocument.lastActivityAt)}</span>
                      </li>
                    </ol>
                  </article>
                </div>

                {detailLoading ? <div className="app-vault-detail-loading">Refreshing detail...</div> : null}
              </>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
