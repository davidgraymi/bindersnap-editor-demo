import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

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

const DEFAULT_UPLOAD_ALLOWED_EXTENSIONS = [".json", ".txt", ".md", ".csv", ".doc", ".docx", ".pdf", ".xls", ".xlsx", ".ppt", ".pptx"];
const uploadAllowedExtensions = (
  appEnv?.BUN_PUBLIC_BINDERSNAP_UPLOAD_ALLOWED_EXTENSIONS ??
  appEnv?.VITE_BINDERSNAP_UPLOAD_ALLOWED_EXTENSIONS ??
  appEnv?.BUN_PUBLIC_UPLOAD_ALLOWED_EXTENSIONS ??
  appEnv?.VITE_UPLOAD_ALLOWED_EXTENSIONS ??
  DEFAULT_UPLOAD_ALLOWED_EXTENSIONS.join(",")
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value.startsWith("."));
const uploadMaxBytesValue = Number.parseInt(
  appEnv?.BUN_PUBLIC_BINDERSNAP_UPLOAD_MAX_BYTES ??
    appEnv?.VITE_BINDERSNAP_UPLOAD_MAX_BYTES ??
    appEnv?.BUN_PUBLIC_UPLOAD_MAX_BYTES ??
    appEnv?.VITE_UPLOAD_MAX_BYTES ??
    "26214400",
  10,
);
const uploadMaxBytes =
  Number.isFinite(uploadMaxBytesValue) && uploadMaxBytesValue > 0
    ? uploadMaxBytesValue
    : 26_214_400;
const uploadAccept = uploadAllowedExtensions.join(",");

type ApprovalState = "none" | "working" | "in_review" | "changes_requested" | "approved" | "published";
type UploadPhase = "idle" | "validating" | "uploading" | "success" | "error";

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

interface DocumentUploadResult {
  documentId: string;
  branchName: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string | null;
  approvalState: ApprovalState;
}

interface UploadRequestError {
  code?: string;
  message: string;
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function readUploadResult(value: unknown): DocumentUploadResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const documentId = typeof value.documentId === "string" ? value.documentId.trim() : "";
  const branchName = typeof value.branchName === "string" ? value.branchName.trim() : "";
  const commitSha = typeof value.commitSha === "string" ? value.commitSha.trim() : "";
  const pullRequestNumber =
    typeof value.pullRequestNumber === "number" && Number.isFinite(value.pullRequestNumber)
      ? value.pullRequestNumber
      : 0;
  const pullRequestUrl =
    typeof value.pullRequestUrl === "string" && value.pullRequestUrl.trim() !== ""
      ? value.pullRequestUrl.trim()
      : null;
  const approvalState = readApprovalState(value.approvalState);

  if (!documentId || !branchName || !commitSha || !approvalState || !pullRequestNumber) {
    return null;
  }

  return {
    documentId,
    branchName,
    commitSha,
    pullRequestNumber,
    pullRequestUrl,
    approvalState,
  };
}

function readUploadError(payload: unknown): UploadRequestError | null {
  if (!isRecord(payload)) {
    return null;
  }

  const errorValue = payload.error;
  const messageFromRoot = typeof payload.message === "string" ? payload.message.trim() : "";

  if (typeof errorValue === "string" && errorValue.trim() !== "") {
    return { message: errorValue.trim() };
  }

  if (isRecord(errorValue)) {
    const code = typeof errorValue.code === "string" ? errorValue.code.trim() : undefined;
    const message =
      typeof errorValue.message === "string" && errorValue.message.trim() !== ""
        ? errorValue.message.trim()
        : messageFromRoot || "Upload failed.";

    return { code, message };
  }

  if (messageFromRoot) {
    return {
      message: messageFromRoot,
    };
  }

  return null;
}

function formatUploadError(payload: unknown, fallback: string): string {
  const details = readUploadError(payload);
  if (!details) {
    return fallback;
  }

  switch (details.code) {
    case "missing_file":
      return "Choose a file before uploading.";
    case "empty_file":
      return "The selected file is empty.";
    case "unsupported_file_type":
      return `Unsupported file type. Allowed: ${uploadAllowedExtensions.join(", ")}.`;
    case "file_too_large":
      return `That file exceeds the ${formatBytes(uploadMaxBytes)} limit.`;
    case "document_not_found":
      return "This document could not be found. Refresh the vault and try again.";
    case "invalid_upload_payload":
      return "Upload the file through the picker, not as text.";
    case "unauthorized":
      return "Your session expired. Sign in again.";
    case "upload_branch_unavailable":
    case "upload_pull_request_unavailable":
    case "upload_write_failed":
    case "upload_commit_unavailable":
      return "The upload could not be saved on the server. Try again in a moment.";
    default:
      return details.message || fallback;
  }
}

function validateUploadFile(file: File | null): UploadRequestError | null {
  if (!file) {
    return {
      code: "missing_file",
      message: "Choose a file before uploading.",
    };
  }

  if (file.size <= 0) {
    return {
      code: "empty_file",
      message: "The selected file is empty.",
    };
  }

  const extension = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
    : "";
  if (!extension || !uploadAllowedExtensions.includes(extension)) {
    return {
      code: "unsupported_file_type",
      message: `Unsupported file type. Allowed: ${uploadAllowedExtensions.join(", ")}.`,
    };
  }

  if (file.size > uploadMaxBytes) {
    return {
      code: "file_too_large",
      message: `That file exceeds the ${formatBytes(uploadMaxBytes)} limit.`,
    };
  }

  return null;
}

function sendUploadRequest(
  documentId: string,
  formData: FormData,
  onProgress: (progress: number | null) => void,
): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", resolveApiUrl(`/api/app/documents/${encodeURIComponent(documentId)}/versions`));
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      } else {
        onProgress(null);
      }
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : null;
      } catch {
        payload = null;
      }

      resolve({
        status: xhr.status,
        payload,
      });
    };

    xhr.onerror = () => {
      reject(new Error("Unable to upload the file right now."));
    };

    xhr.onabort = () => {
      reject(new Error("The upload was canceled."));
    };

    xhr.send(formData);
  });
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
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSummary, setUploadSummary] = useState("");
  const [uploadSourceNote, setUploadSourceNote] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadRefreshNotice, setUploadRefreshNotice] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<DocumentUploadResult | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const selectedDocumentIdRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const uploadRequestIdRef = useRef(0);

  const selectedDocument = useMemo(() => {
    if (detailDocument && detailDocument.id === selectedDocumentId) {
      return detailDocument;
    }

    return documents.find((document) => document.id === selectedDocumentId) ?? null;
  }, [detailDocument, documents, selectedDocumentId]);

  const loadDocumentDetail = useCallback(async (documentId: string) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);
    setDetailError(null);

    try {
      const payload = await fetchDocumentDetail(documentId);
      if (detailRequestIdRef.current !== requestId || selectedDocumentIdRef.current !== documentId) {
        return;
      }
      setDetailDocument(payload.document);
      setRepository(payload.repository);
    } catch (loadError) {
      if (detailRequestIdRef.current !== requestId || selectedDocumentIdRef.current !== documentId) {
        return;
      }
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Unable to load document details.";
      setDetailError(message);
      setDetailDocument(null);
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
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

      selectedDocumentIdRef.current = nextSelectedDocumentId;
      setSelectedDocumentId(nextSelectedDocumentId);

      if (nextSelectedDocumentId) {
        void loadDocumentDetail(nextSelectedDocumentId);
      } else {
        detailRequestIdRef.current += 1;
        setDetailLoading(false);
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
      detailRequestIdRef.current += 1;
      setDetailLoading(false);
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

  useEffect(() => {
    setUploadFile(null);
    setUploadSummary("");
    setUploadSourceNote("");
    setUploadProgress(null);
    setUploadPhase("idle");
    setUploadError(null);
    setUploadRefreshNotice(null);
    setUploadResult(null);
    setUploadInputKey((current) => current + 1);
  }, [selectedDocumentId]);

  const totalPendingCount = documents.reduce(
    (count, document) => count + (document.latestPendingPullRequest ? 1 : 0),
    0,
  );
  const latestWorkspaceActivity = documents[0]?.lastActivityTimestamp || documents[0]?.lastActivityAt || "";
  const selectedUploadResult =
    uploadResult && selectedDocument && uploadResult.documentId === selectedDocument.id ? uploadResult : null;
  const selectedUploadError = uploadError;
  const uploadProgressLabel =
    uploadPhase === "uploading" && uploadProgress !== null
      ? `${uploadProgress}%`
      : uploadPhase === "uploading"
        ? "Uploading..."
        : uploadPhase === "success"
          ? "Upload complete"
          : uploadPhase === "validating"
            ? "Validating..."
            : "Ready to upload";

  const handleUploadFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setUploadRefreshNotice(null);
    setUploadResult(null);
    setUploadPhase("idle");
    setUploadProgress(null);

    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setUploadFile(null);
      return;
    }

    setUploadFile(file);
  };

  const handleUploadSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!selectedDocument) {
        setUploadError("Select a document before uploading a new version.");
        setUploadPhase("error");
        return;
      }

      const validation = validateUploadFile(uploadFile);
      if (validation) {
        setUploadError(validation.message);
        setUploadPhase("error");
        setUploadProgress(null);
        return;
      }

      const requestId = uploadRequestIdRef.current + 1;
      uploadRequestIdRef.current = requestId;
      setUploadPhase("validating");
      setUploadError(null);
      setUploadRefreshNotice(null);
      setUploadResult(null);
      setUploadProgress(0);
      setUploadPhase("uploading");

      const formData = new FormData();
      formData.set("file", uploadFile);

      const summary = uploadSummary.trim();
      if (summary) {
        formData.set("summary", summary);
      }

      const sourceNote = uploadSourceNote.trim();
      if (sourceNote) {
        formData.set("source_note", sourceNote);
      }

      try {
        const response = await sendUploadRequest(selectedDocument.id, formData, (progress) => {
          if (uploadRequestIdRef.current !== requestId) {
            return;
          }

          setUploadProgress(progress);
        });

        if (uploadRequestIdRef.current !== requestId || selectedDocumentIdRef.current !== selectedDocument.id) {
          return;
        }

        if (response.status < 200 || response.status >= 300) {
          throw new Error(formatUploadError(response.payload, "Unable to upload the file right now."));
        }

        const result = readUploadResult(response.payload);
        if (!result) {
          throw new Error("The upload completed, but the server did not return version metadata.");
        }

        setUploadResult(result);
        setUploadPhase("success");
        setUploadProgress(100);
        setUploadFile(null);
        setUploadSummary("");
        setUploadSourceNote("");
        setUploadInputKey((current) => current + 1);

        try {
          await loadDocuments();
        } catch (refreshError) {
          if (uploadRequestIdRef.current !== requestId) {
            return;
          }

          const refreshMessage =
            refreshError instanceof Error
              ? refreshError.message
              : "Unable to refresh the vault right now.";
          setUploadRefreshNotice(
            `Upload succeeded and PR #${result.pullRequestNumber} was created, but refresh failed: ${refreshMessage}`,
          );
        }
      } catch (uploadSubmissionError) {
        if (uploadRequestIdRef.current !== requestId) {
          return;
        }

        const message =
          uploadSubmissionError instanceof Error
            ? uploadSubmissionError.message
            : "Unable to upload the file right now.";
        setUploadError(message);
        setUploadPhase("error");
        setUploadProgress(null);
      }
    },
    [loadDocuments, selectedDocument, uploadFile, uploadSourceNote, uploadSummary],
  );

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
                      selectedDocumentIdRef.current = document.id;
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

                  <article className="app-vault-detail-block app-upload-panel">
                    <div className="bs-eyebrow">Upload Revision</div>
                    <h3>Submit a new file version for review</h3>
                    <p className="app-vault-upload-copy">
                      Choose a replacement file, add optional notes, and Bindersnap will create the review branch and pull
                      request for you.
                    </p>

                    <form className="app-vault-upload-form" onSubmit={handleUploadSubmit}>
                      <label className="app-vault-upload-field">
                        <span className="bs-label">File</span>
                        <input
                          key={`${selectedDocument.id}-${uploadInputKey}`}
                          className="bs-input app-vault-upload-input"
                          type="file"
                          accept={uploadAccept}
                          onChange={handleUploadFileChange}
                        />
                        <span className="app-vault-upload-hint">
                          Allowed: {uploadAllowedExtensions.join(", ")} up to {formatBytes(uploadMaxBytes)}.
                        </span>
                      </label>

                      <label className="app-vault-upload-field">
                        <span className="bs-label">Summary</span>
                        <input
                          className="bs-input"
                          type="text"
                          value={uploadSummary}
                          onChange={(event) => {
                            setUploadSummary(event.target.value);
                            setUploadError(null);
                            setUploadResult(null);
                            setUploadPhase("idle");
                          }}
                          placeholder="Short note about this revision"
                        />
                      </label>

                      <label className="app-vault-upload-field">
                        <span className="bs-label">Source note</span>
                        <textarea
                          className="bs-input app-vault-upload-textarea"
                          value={uploadSourceNote}
                          onChange={(event) => {
                            setUploadSourceNote(event.target.value);
                            setUploadError(null);
                            setUploadResult(null);
                            setUploadPhase("idle");
                          }}
                          placeholder="Where did this file come from?"
                          rows={4}
                        />
                      </label>

                      <div className="app-vault-upload-status" aria-live="polite">
                        <span className={`app-status-badge app-status-badge--${uploadPhase === "error" ? "alert" : uploadPhase === "success" ? "good" : "pending"}`}>
                          {uploadProgressLabel}
                        </span>
                        {selectedUploadError ? <p className="app-vault-upload-error">{selectedUploadError}</p> : null}
                        {uploadRefreshNotice ? <p className="app-vault-upload-note">{uploadRefreshNotice}</p> : null}
                        {uploadPhase === "uploading" ? (
                          <div className="app-vault-upload-progress-wrap">
                            <progress
                              className="app-vault-upload-progress"
                              max={100}
                              value={uploadProgress === null ? undefined : uploadProgress}
                            />
                            <span className="app-vault-upload-progress-label">
                              {uploadProgress !== null ? `${uploadProgress}%` : "Uploading..."}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <button
                        className="bs-btn bs-btn-primary"
                        type="submit"
                        disabled={!selectedDocument || uploadPhase === "uploading" || uploadPhase === "validating"}
                      >
                        {uploadPhase === "uploading" ? "Uploading..." : "Submit for review"}
                      </button>
                    </form>

                    {selectedUploadResult ? (
                      <div className="app-vault-upload-result">
                        <div className="app-vault-upload-result-head">
                          <span className="app-status-badge app-status-badge--good">Upload complete</span>
                          {selectedUploadResult.pullRequestUrl ? (
                            <a href={selectedUploadResult.pullRequestUrl} target="_blank" rel="noreferrer">
                              Open pull request
                            </a>
                          ) : null}
                        </div>
                        <dl>
                          <div>
                            <dt>Pull request</dt>
                            <dd>#{selectedUploadResult.pullRequestNumber}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{formatPendingState(selectedUploadResult.approvalState)}</dd>
                          </div>
                          <div>
                            <dt>Branch</dt>
                            <dd>{selectedUploadResult.branchName}</dd>
                          </div>
                          <div>
                            <dt>Commit</dt>
                            <dd>{selectedUploadResult.commitSha}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : null}
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
