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
import {
  notifyPaymentRequired,
  shouldInterceptPaymentRequired,
} from "./paymentRequired";
import type { DocumentSearchParams } from "./documentSearch";

// Bun's bundler (`bun build --env='BUN_PUBLIC_*'`) replaces
// process.env.BUN_PUBLIC_API_BASE_URL with a literal string at compile time.
// - GitHub Pages build: BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com
// - Local dev stack:    BUN_PUBLIC_API_BASE_URL=http://localhost:8788
const API_BASE_URL = (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

export interface SessionUser {
  username: string;
  fullName?: string;
  isAdmin?: boolean;
}

export interface SessionAuthState {
  user: SessionUser | null;
  token: string | null;
}

export interface AdminSubscriptionAccessState {
  username: string;
  hasProAccess: boolean;
  source: string | null;
  overrideActive: boolean | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type AdminSubscriptionAccessSource =
  | "config_bypass"
  | "stripe"
  | "admin_grant"
  | "admin_revoke"
  | "none";

export interface AdminSubscriptionAccessOverride {
  username: string;
  access: "grant" | "revoke";
  updatedBy: string;
  updatedAt: number;
}

export interface AdminSubscriptionAccessUser {
  username: string;
  fullName?: string;
  email?: string;
  hasAccess: boolean;
  accessSource: AdminSubscriptionAccessSource;
  stripeStatus: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  override: AdminSubscriptionAccessOverride | null;
}

export interface AdminSubscriptionAccessListPayload {
  users: AdminSubscriptionAccessUser[];
  page: number;
  limit: number;
  hasMore: boolean;
  query: string;
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

export interface DocumentPermissionsPayload {
  branchProtection: {
    requiredApprovals: number;
    enableApprovalsWhitelist: boolean;
    approvalsWhitelistUsernames: string[];
    approvalsWhitelistTeams: string[];
    enableMergeWhitelist: boolean;
    mergeWhitelistUsernames: string[];
    mergeWhitelistTeams: string[];
    blockOnRejectedReviews: boolean;
  } | null;
  isPrivate: boolean;
  isInternal: boolean;
  currentUserPermission?: RepoCollaboratorPermissionSummary | null;
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

function readBooleanField(
  payload: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number" && (value === 0 || value === 1)) {
      return value === 1;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }

      if (normalized === "false") {
        return false;
      }
    }
  }

  return null;
}

function readRecordField(
  payload: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
  }

  return null;
}

function readStringFieldFromRecords(
  payloads: Record<string, unknown>[],
  keys: string[],
): string | null {
  for (const payload of payloads) {
    const value = readStringField(payload, keys);
    if (value) {
      return value;
    }
  }

  return null;
}

function readBooleanFieldFromRecords(
  payloads: Record<string, unknown>[],
  keys: string[],
): boolean | null {
  for (const payload of payloads) {
    const value = readBooleanField(payload, keys);
    if (value !== null) {
      return value;
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
  const isAdmin =
    readBooleanField(payload, [
      "isAdmin",
      "is_admin",
      "siteAdmin",
      "site_admin",
      "admin",
    ]) ??
    (nestedUser
      ? readBooleanField(nestedUser, [
          "isAdmin",
          "is_admin",
          "siteAdmin",
          "site_admin",
          "admin",
        ])
      : null);

  return {
    username,
    fullName: fullName ?? undefined,
    isAdmin: isAdmin ?? undefined,
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

function parseAdminSubscriptionAccessState(
  payload: unknown,
  fallbackUsername: string,
): AdminSubscriptionAccessState {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Admin subscription response was empty.");
  }

  const root = payload as Record<string, unknown>;
  const nestedPayloads = [
    root,
    readRecordField(root, ["subscription", "access", "override", "result"]),
    readRecordField(root, ["user"]),
  ].filter((value): value is Record<string, unknown> => value !== null);

  const username =
    readStringFieldFromRecords(nestedPayloads, [
      "username",
      "login",
      "userName",
    ]) ?? fallbackUsername;
  const hasProAccess = readBooleanFieldFromRecords(nestedPayloads, [
    "hasProAccess",
    "has_pro_access",
    "proAccess",
    "pro_access",
    "hasSubscription",
    "has_subscription",
    "active",
    "isActive",
    "enabled",
  ]);

  if (hasProAccess === null) {
    throw new Error("Admin subscription response was missing access state.");
  }

  return {
    username,
    hasProAccess,
    source: readStringFieldFromRecords(nestedPayloads, [
      "source",
      "statusSource",
      "status_source",
      "reason",
    ]),
    overrideActive: readBooleanFieldFromRecords(nestedPayloads, [
      "overrideActive",
      "override_active",
      "manualOverride",
      "manual_override",
    ]),
    updatedAt: readStringFieldFromRecords(nestedPayloads, [
      "updatedAt",
      "updated_at",
      "lastUpdatedAt",
      "last_updated_at",
    ]),
    updatedBy: readStringFieldFromRecords(nestedPayloads, [
      "updatedBy",
      "updated_by",
      "grantedBy",
      "granted_by",
      "revokedBy",
      "revoked_by",
    ]),
  };
}

interface AdminRequestAttempt {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
}

async function requestAdminPayload(
  attempts: AdminRequestAttempt[],
  fallbackError: string,
): Promise<unknown> {
  let lastErrorMessage: string | null = null;

  for (const attempt of attempts) {
    const response = await fetchApi(attempt.path, {
      method: attempt.method,
      headers: {
        Accept: "application/json",
        ...(attempt.body
          ? {
              "Content-Type": "application/json",
            }
          : {}),
      },
      body: attempt.body ? JSON.stringify(attempt.body) : undefined,
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (response.status === 404 || response.status === 405) {
      lastErrorMessage = readErrorMessage(payload, fallbackError);
      continue;
    }

    if (!response.ok) {
      throw new Error(readErrorMessage(payload, fallbackError));
    }

    return payload;
  }

  throw new Error(lastErrorMessage ?? fallbackError);
}

function buildAdminSubscriptionStatusAttempts(
  username: string,
): AdminRequestAttempt[] {
  const encodedUsername = encodeURIComponent(username);

  return [
    {
      path: `/api/app/admin/subscriptions/${encodedUsername}`,
      method: "GET",
    },
    {
      path: `/api/app/admin/pro-access/${encodedUsername}`,
      method: "GET",
    },
    {
      path: `/api/app/admin/users/${encodedUsername}/subscription`,
      method: "GET",
    },
    {
      path: `/api/app/admin/subscription-overrides/${encodedUsername}`,
      method: "GET",
    },
  ];
}

function buildAdminSubscriptionMutationAttempts(
  username: string,
  hasProAccess: boolean,
): AdminRequestAttempt[] {
  const encodedUsername = encodeURIComponent(username);

  return hasProAccess
    ? [
        {
          path: `/api/app/admin/subscriptions/${encodedUsername}/grant`,
          method: "POST",
        },
        {
          path: `/api/app/admin/subscriptions/${encodedUsername}`,
          method: "PUT",
          body: { hasProAccess: true },
        },
        {
          path: `/api/app/admin/pro-access/${encodedUsername}/grant`,
          method: "POST",
        },
        {
          path: `/api/app/admin/users/${encodedUsername}/subscription`,
          method: "PUT",
          body: { hasProAccess: true },
        },
        {
          path: `/api/app/admin/subscription-overrides/${encodedUsername}`,
          method: "POST",
          body: { hasProAccess: true, action: "grant" },
        },
      ]
    : [
        {
          path: `/api/app/admin/subscriptions/${encodedUsername}/revoke`,
          method: "POST",
        },
        {
          path: `/api/app/admin/subscriptions/${encodedUsername}`,
          method: "DELETE",
        },
        {
          path: `/api/app/admin/pro-access/${encodedUsername}/revoke`,
          method: "POST",
        },
        {
          path: `/api/app/admin/users/${encodedUsername}/subscription`,
          method: "PUT",
          body: { hasProAccess: false },
        },
        {
          path: `/api/app/admin/subscription-overrides/${encodedUsername}`,
          method: "DELETE",
        },
      ];
}

function maybeHandlePaymentRequired(path: string, response: Response): void {
  if (response.status === 402 && shouldInterceptPaymentRequired(path)) {
    notifyPaymentRequired();
  }
}

async function fetchApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(resolveApiUrl(path), {
    credentials: "include",
    ...init,
  });

  maybeHandlePaymentRequired(path, response);

  return response;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fallbackError = "Request failed.",
): Promise<T> {
  const response = await fetchApi(path, init);

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

export type { DocumentSearchParams } from "./documentSearch";
export { parseDocumentSearchQuery } from "./documentSearch";

export async function getWorkspaceDocuments(
  params?: DocumentSearchParams,
): Promise<WorkspaceDocumentSummary[]> {
  const qs = new URLSearchParams();
  if (params?.ownerUsername) qs.set("owner", params.ownerUsername);
  if (params?.memberUsername) qs.set("member", params.memberUsername);
  if (params?.freeText) qs.set("q", params.freeText);
  const query = qs.toString();
  const path = query ? `/api/app/documents?${query}` : "/api/app/documents";

  const payload = await requestJson<{ documents?: WorkspaceDocumentSummary[] }>(
    path,
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
  const path = `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/download?ref=${encodeURIComponent(ref)}`;
  const response = await fetchApi(path, {
    method: "GET",
    headers: {
      Accept: "*/*",
    },
  });

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

export async function listAdminSubscriptionAccess(
  query = "",
  page = 1,
  limit = 12,
): Promise<AdminSubscriptionAccessListPayload> {
  return requestJson<AdminSubscriptionAccessListPayload>(
    `/api/app/admin/subscriptions/access?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to load admin subscription access.",
  );
}

export async function setAdminSubscriptionAccess(
  username: string,
  access: "grant" | "revoke",
): Promise<AdminSubscriptionAccessUser> {
  const payload = await requestJson<{ user: AdminSubscriptionAccessUser }>(
    `/api/app/admin/subscriptions/access/${encodeURIComponent(username)}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access }),
    },
    "Unable to update admin subscription access.",
  );

  return payload.user;
}

export async function clearAdminSubscriptionAccess(
  username: string,
): Promise<void> {
  await requestJson(
    `/api/app/admin/subscriptions/access/${encodeURIComponent(username)}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
      },
    },
    "Unable to clear admin subscription access override.",
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

export async function getDocumentPermissions(
  owner: string,
  repo: string,
): Promise<DocumentPermissionsPayload> {
  return requestJson<DocumentPermissionsPayload>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/permissions`,
    { method: "GET", headers: { Accept: "application/json" } },
    "Unable to load document permissions.",
  );
}

export async function updateDocumentPermissions(
  owner: string,
  repo: string,
  updates: {
    requiredApprovals?: number;
    enableApprovalsWhitelist?: boolean;
    approvalsWhitelistUsernames?: string[];
    enableMergeWhitelist?: boolean;
    mergeWhitelistUsernames?: string[];
    isPrivate?: boolean;
  },
): Promise<DocumentPermissionsPayload> {
  return requestJson<DocumentPermissionsPayload>(
    `/api/app/documents/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/permissions`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Unable to update document permissions.",
  );
}

export function validateUploadFile(file: File): UploadValidationResult {
  return validateUploadFileWithClient(file);
}

export async function fetchAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("Enter a username to look up Pro access.");
  }

  const payload = await requestAdminPayload(
    buildAdminSubscriptionStatusAttempts(normalizedUsername),
    "Unable to load Pro access details.",
  );

  return parseAdminSubscriptionAccessState(payload, normalizedUsername);
}

async function updateAdminSubscriptionAccess(
  username: string,
  hasProAccess: boolean,
): Promise<AdminSubscriptionAccessState> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("Enter a username before changing Pro access.");
  }

  await requestAdminPayload(
    buildAdminSubscriptionMutationAttempts(normalizedUsername, hasProAccess),
    hasProAccess
      ? "Unable to grant Bindersnap Pro access."
      : "Unable to revoke Bindersnap Pro access.",
  );

  return fetchAdminSubscriptionAccess(normalizedUsername);
}

export async function grantAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  return updateAdminSubscriptionAccess(username, true);
}

export async function revokeAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  return updateAdminSubscriptionAccess(username, false);
}

export { clearStoredToken as clearToken, storeStoredToken as storeToken };

export type { InitialDocumentUploadResult, UploadResult };

export async function fetchBillingStatus(): Promise<{
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  hasAccess: boolean;
  accessSource: AdminSubscriptionAccessSource | null;
  override: AdminSubscriptionAccessOverride | null;
  plan: {
    amount: number;
    currency: string;
    interval: string;
    formatted: string;
  } | null;
}> {
  const response = await fetchApi("/api/app/billing/status", {
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 404) {
    return {
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      hasAccess: false,
      accessSource: null,
      override: null,
      plan: null,
    };
  }
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  const planData = payload?.plan as Record<string, unknown> | null | undefined;
  const plan =
    planData &&
    typeof planData === "object" &&
    typeof planData.amount === "number" &&
    typeof planData.currency === "string" &&
    typeof planData.interval === "string" &&
    typeof planData.formatted === "string"
      ? {
          amount: planData.amount,
          currency: planData.currency,
          interval: planData.interval,
          formatted: planData.formatted,
        }
      : null;

  return {
    status: typeof payload?.status === "string" ? payload.status : null,
    currentPeriodEnd:
      typeof payload?.currentPeriodEnd === "number"
        ? payload.currentPeriodEnd
        : null,
    cancelAtPeriodEnd: payload?.cancelAtPeriodEnd === true,
    cancelAt: typeof payload?.cancelAt === "number" ? payload.cancelAt : null,
    hasAccess: payload?.hasAccess === true,
    accessSource:
      payload?.accessSource === "config_bypass" ||
      payload?.accessSource === "stripe" ||
      payload?.accessSource === "admin_grant" ||
      payload?.accessSource === "admin_revoke" ||
      payload?.accessSource === "none"
        ? payload.accessSource
        : null,
    override:
      payload?.override &&
      typeof payload.override === "object" &&
      typeof (payload.override as Record<string, unknown>).username ===
        "string" &&
      typeof (payload.override as Record<string, unknown>).access ===
        "string" &&
      typeof (payload.override as Record<string, unknown>).updatedBy ===
        "string" &&
      typeof (payload.override as Record<string, unknown>).updatedAt ===
        "number"
        ? {
            username: (payload.override as Record<string, unknown>)
              .username as string,
            access: (payload.override as Record<string, unknown>).access as
              | "grant"
              | "revoke",
            updatedBy: (payload.override as Record<string, unknown>)
              .updatedBy as string,
            updatedAt: (payload.override as Record<string, unknown>)
              .updatedAt as number,
          }
        : null,
    plan,
  };
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/checkout",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
    "Unable to start checkout.",
  );
}

export async function createPortalSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/portal",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
    "Unable to open billing portal.",
  );
}
