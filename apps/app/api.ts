import {
  clearToken as clearStoredToken,
  storeToken as storeStoredToken,
} from "../../packages/gitea-client/auth";
import type {
  DocTag,
  RepoBranchProtection,
  RepoCollaboratorPermissionSummary,
  RepoUserSummary,
  WorkspaceRepo,
} from "../../packages/gitea-client/repos";
import type { PullRequestWithApprovalState } from "../../packages/gitea-client/pullRequests";
import type {
  InitialDocumentUploadResult,
  UploadResult,
  UploadValidationResult,
} from "../../packages/gitea-client/uploads";
import { validateUploadFile as validateUploadFileWithClient } from "../../packages/gitea-client/uploads";

// Bun's bundler (`bun build --env='BUN_PUBLIC_*'`) replaces
// process.env.BUN_PUBLIC_API_BASE_URL with a literal string at compile time.
// - GitHub Pages build: BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com
// - Local dev stack:    BUN_PUBLIC_API_BASE_URL=http://localhost:8787
const API_BASE_URL = (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

export interface SessionUser {
  username: string;
  fullName?: string;
}

export interface SessionAuthState {
  user: SessionUser | null;
  token: string | null;
}

export interface WorkspaceDocumentSummary {
  repo: WorkspaceRepo;
  latestTag: DocTag | null;
  pendingPRs: PullRequestWithApprovalState[];
  error: string | null;
}

export interface CanonicalFileInfo {
  storedFileName: string;
  downloadFileName: string;
}

export interface DocumentDetailPayload {
  repository: WorkspaceRepo;
  tags: DocTag[];
  latestTag: DocTag | null;
  openPullRequests: PullRequestWithApprovalState[];
  uploadPullRequests: PullRequestWithApprovalState[];
  branchProtection: RepoBranchProtection | null;
  canonicalFile: CanonicalFileInfo | null;
  currentUserPermission: RepoCollaboratorPermissionSummary | null;
}

export interface CollaboratorListPayload {
  collaborators: RepoCollaboratorPermissionSummary[];
  page: number;
  limit: number;
  hasMore: boolean;
  currentUserPermission: RepoCollaboratorPermissionSummary | null;
}

export interface SearchUsersPayload {
  users: RepoUserSummary[];
  page: number;
  limit: number;
  hasMore: boolean;
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

function readStringField(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function parseSessionUser(
  payload: Record<string, unknown>,
): SessionUser | null {
  const nestedUser =
    typeof payload.user === "object" && payload.user !== null
      ? (payload.user as Record<string, unknown>)
      : null;
  const username =
    readStringField(payload, ["username", "login"]) ??
    (nestedUser ? readStringField(nestedUser, ["username", "login"]) : null);

  if (!username) {
    return null;
  }

  const fullName =
    readStringField(payload, ["fullName", "full_name"]) ??
    (nestedUser
      ? readStringField(nestedUser, ["fullName", "full_name"])
      : null);

  return {
    username,
    fullName: fullName ?? undefined,
  };
}

function parseSessionAuthState(payload: unknown): SessionAuthState {
  if (typeof payload !== "object" || payload === null) {
    return { user: null, token: null };
  }

  const root = payload as Record<string, unknown> & { user?: unknown };
  const nestedUser =
    typeof root.user === "object" && root.user !== null
      ? (root.user as Record<string, unknown>)
      : null;

  const token =
    readStringField(root, ["token", "giteaToken", "gitea_token"]) ??
    (nestedUser
      ? readStringField(nestedUser, ["token", "giteaToken", "gitea_token"])
      : null);

  return {
    user:
      parseSessionUser(root) ??
      (nestedUser ? parseSessionUser(nestedUser) : null),
    token,
  };
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fallbackError = "Request failed.",
): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    credentials: "include",
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, fallbackError));
  }

  return payload as T;
}

async function sendAuthRequest(
  path: "/auth/login" | "/auth/signup",
  username: string | null,
  email: string,
  password: string,
  rememberMe?: boolean,
): Promise<SessionAuthState> {
  const payload = await requestJson<unknown>(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, email, password, rememberMe }),
    },
    "Unable to complete authentication right now.",
  );

  return parseSessionAuthState(payload);
}

function buildMultipartForm(
  fields: Record<string, string | number | File | null | undefined>,
): FormData {
  const formData = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (value instanceof File) {
      formData.append(key, value);
      continue;
    }

    formData.append(key, String(value));
  }

  return formData;
}

export async function login(
  identifier: string,
  password: string,
  rememberMe = true,
): Promise<SessionAuthState> {
  const trimmed = identifier.trim();
  return sendAuthRequest(
    "/auth/login",
    trimmed.includes("@") ? null : trimmed,
    trimmed.includes("@") ? trimmed : "",
    password,
    rememberMe,
  );
}

export async function signup(
  username: string,
  email: string,
  password: string,
): Promise<SessionAuthState> {
  return sendAuthRequest(
    "/auth/signup",
    username.trim(),
    email.trim(),
    password,
  );
}

export async function fetchSessionUser(): Promise<SessionAuthState | null> {
  const response = await fetch(resolveApiUrl("/auth/me"), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 404) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload, "Unable to check your session right now."),
    );
  }

  return parseSessionAuthState(payload);
}

export async function logoutSession(): Promise<void> {
  await fetch(resolveApiUrl("/auth/logout"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  }).catch(() => undefined);
}

export async function getWorkspaceDocuments(): Promise<
  WorkspaceDocumentSummary[]
> {
  const payload = await requestJson<{ documents?: WorkspaceDocumentSummary[] }>(
    "/api/app/documents",
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to load workspace documents.",
  );

  return payload.documents ?? [];
}

export async function createInitialDocumentUpload(
  repoName: string,
  file: File,
  nextVersion: number,
  requiredApprovals = 1,
  description?: string,
): Promise<InitialDocumentUploadResult> {
  return requestJson<InitialDocumentUploadResult>(
    "/api/app/documents",
    {
      method: "POST",
      body: buildMultipartForm({
        file,
        repoName,
        nextVersion,
        requiredApprovals,
        description,
      }),
    },
    "Unable to create document.",
  );
}

export async function getDocumentDetail(
  owner: string,
  repo: string,
): Promise<DocumentDetailPayload> {
  return requestJson<DocumentDetailPayload>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to load document details.",
  );
}

export async function uploadDocumentVersion(params: {
  owner: string;
  repo: string;
  docSlug: string;
  uploaderSlug: string;
  nextVersion: number;
  canonicalFileName?: string | null;
  file: File;
}): Promise<UploadResult> {
  const {
    owner,
    repo,
    docSlug,
    uploaderSlug,
    nextVersion,
    canonicalFileName,
    file,
  } = params;

  return requestJson<UploadResult>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/versions`,
    {
      method: "POST",
      body: buildMultipartForm({
        file,
        docSlug,
        uploaderSlug,
        nextVersion,
        canonicalFileName,
      }),
    },
    "Unable to upload the new version.",
  );
}

export async function submitDocumentReview(
  owner: string,
  repo: string,
  pullNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string,
): Promise<void> {
  await requestJson(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull-requests/${pullNumber}/reviews`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ event, body }),
    },
    "Unable to submit review.",
  );
}

export async function publishDocument(
  owner: string,
  repo: string,
  pullNumber: number,
  nextVersion: number,
): Promise<{ ok: boolean; tag: DocTag }> {
  return requestJson<{ ok: boolean; tag: DocTag }>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull-requests/${pullNumber}/publish`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ nextVersion }),
    },
    "Unable to publish the document.",
  );
}

export async function downloadDocument(
  owner: string,
  repo: string,
  ref: string,
): Promise<Blob> {
  const response = await fetch(
    resolveApiUrl(
      `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/download?ref=${encodeURIComponent(ref)}`,
    ),
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "*/*",
      },
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as unknown;
    throw new Error(readErrorMessage(payload, "Unable to download document."));
  }

  return response.blob();
}

export async function listDocumentCollaborators(
  owner: string,
  repo: string,
  page = 1,
  limit = 12,
): Promise<CollaboratorListPayload> {
  return requestJson<CollaboratorListPayload>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?page=${page}&limit=${limit}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to load collaborators.",
  );
}

export async function searchWorkspaceUsers(
  query: string,
  page = 1,
  limit = 8,
): Promise<SearchUsersPayload> {
  return requestJson<SearchUsersPayload>(
    `/api/app/users/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to search users.",
  );
}

export async function addDocumentCollaborator(
  owner: string,
  repo: string,
  collaborator: string,
  permission: "read" | "write" | "admin",
): Promise<RepoCollaboratorPermissionSummary | null> {
  const payload = await requestJson<{
    collaborator?: RepoCollaboratorPermissionSummary;
  }>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(collaborator)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ permission }),
    },
    "Unable to update collaborator access.",
  );

  return payload.collaborator ?? null;
}

export async function removeDocumentCollaborator(
  owner: string,
  repo: string,
  collaborator: string,
): Promise<void> {
  await requestJson(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(collaborator)}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to remove collaborator.",
  );
}

export function validateUploadFile(file: File): UploadValidationResult {
  return validateUploadFileWithClient(file);
}

export { clearStoredToken as clearToken, storeStoredToken as storeToken };

export type { InitialDocumentUploadResult, UploadResult };

export async function fetchBillingStatus(): Promise<{
  status: string | null;
  currentPeriodEnd: number | null;
}> {
  const response = await fetch(resolveApiUrl("/api/app/billing/status"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 404) {
    return { status: null, currentPeriodEnd: null };
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return {
    status: typeof payload?.status === "string" ? payload.status : null,
    currentPeriodEnd:
      typeof payload?.currentPeriodEnd === "number"
        ? payload.currentPeriodEnd
        : null,
  };
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/checkout",
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
    "Unable to start checkout.",
  );
}

export async function createPortalSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/portal",
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
    "Unable to open billing portal.",
  );
}
