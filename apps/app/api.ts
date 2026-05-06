// Re-export gitea-client auth (token ops, not API calls)
export {
  clearToken as clearStoredToken,
  storeToken as storeStoredToken,
} from "../../packages/gitea-client/auth";

// Re-export document search utilities
export type { DocumentSearchParams } from "./documentSearch";
export { parseDocumentSearchQuery } from "./documentSearch";

// Import generated API functions
import * as AuthClient from "../../packages/api-client/auth/auth";
import * as DocumentsClient from "../../packages/api-client/documents/documents";
import * as UsersClient from "../../packages/api-client/users/users";
import * as BillingClient from "../../packages/api-client/billing/billing";
import * as AdminClient from "../../packages/api-client/admin/admin";

// Import generated types
import type { SessionAuthState } from "../../packages/api-schema/schemas/auth";
import type {
  CollaboratorListPayload,
  DocumentDetailPayload,
  DocumentPermissionsPayload,
  InitialDocumentUploadResult,
  UploadResult,
  WorkspaceDocumentSummary,
} from "../../packages/api-schema/schemas/documents";
import type { SearchUsersPayload } from "../../packages/api-schema/schemas/users";
import type {
  AdminSubscriptionAccessSource,
  BillingStatusPayload,
} from "../../packages/api-schema/schemas/billing";
import type {
  AdminSubscriptionAccessListPayload,
  AdminSubscriptionAccessUser,
  AdminSubscriptionAccessOverride,
} from "../../packages/api-schema/schemas/admin";

// Re-export all generated types
export type {
  SessionAuthState,
  SessionUser,
} from "../../packages/api-schema/schemas/auth";
export type {
  CollaboratorListPayload,
  DocumentDetailPayload,
  DocumentPermissionsPayload,
  WorkspaceDocumentSummary,
  InitialDocumentUploadResult,
  UploadResult,
} from "../../packages/api-schema/schemas/documents";
export type {
  AdminSubscriptionAccessListPayload,
  AdminSubscriptionAccessUser,
  AdminSubscriptionAccessOverride,
  AdminSubscriptionAccessSource,
  BillingStatusPayload,
} from "../../packages/api-schema/schemas/billing";
export type { SearchUsersPayload } from "../../packages/api-schema/schemas/users";

// Re-export from gitea-client for validation
export { validateUploadFile as validateUploadFileWithClient } from "../../packages/gitea-client/uploads";
export type { UploadValidationResult } from "../../packages/gitea-client/uploads";

import { ApiRequestError } from "../../packages/api-client/mutator";
import {
  notifyPaymentRequired,
  shouldInterceptPaymentRequired,
} from "./paymentRequired";
import type { DocumentSearchParams } from "./documentSearch";

function handlePaymentRequired(path: string, error: unknown): never {
  if (
    error instanceof ApiRequestError &&
    error.status === 402 &&
    shouldInterceptPaymentRequired(path)
  ) {
    notifyPaymentRequired();
  }
  throw error;
}

// Auth functions

export async function login(
  identifier: string,
  password: string,
  rememberMe = true,
): Promise<SessionAuthState> {
  const trimmed = identifier.trim();
  const isEmail = trimmed.includes("@");
  const response = await AuthClient.authLogin({
    username: isEmail ? undefined : trimmed,
    email: isEmail ? trimmed : undefined,
    password,
    rememberMe,
  });
  return response.data;
}

export async function signup(
  username: string,
  email: string,
  password: string,
): Promise<SessionAuthState> {
  const response = await AuthClient.authSignup({
    username: username.trim(),
    email: email.trim(),
    password,
  });
  return response.data;
}

export async function fetchSessionUser(): Promise<SessionAuthState | null> {
  try {
    const response = await AuthClient.authMe();
    return response.data;
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      (error.status === 401 || error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

export async function logoutSession(): Promise<void> {
  await AuthClient.authLogout().catch(() => undefined);
}

// Document functions

export async function getWorkspaceDocuments(
  params?: DocumentSearchParams,
): Promise<WorkspaceDocumentSummary[]> {
  try {
    const response = await DocumentsClient.listDocuments({
      owner: params?.ownerUsername,
      member: params?.memberUsername,
      q: params?.freeText,
    });
    return response.data.documents ?? [];
  } catch (error) {
    handlePaymentRequired("/api/app/documents", error);
  }
}

export async function createInitialDocumentUpload(
  repoName: string,
  file: File,
  nextVersion: number,
  requiredApprovals = 1,
  description?: string,
): Promise<InitialDocumentUploadResult> {
  try {
    const response = await DocumentsClient.createDocument({
      file,
      repoName,
      nextVersion: String(nextVersion),
      requiredApprovals: String(requiredApprovals),
      description,
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/documents", error);
  }
}

export async function getDocumentDetail(
  owner: string,
  repo: string,
): Promise<DocumentDetailPayload> {
  try {
    const response = await DocumentsClient.getDocumentDetail(owner, repo);
    return response.data;
  } catch (error) {
    handlePaymentRequired(`/api/app/documents/${owner}/${repo}`, error);
  }
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

  try {
    const response = await DocumentsClient.uploadDocumentVersion(owner, repo, {
      file,
      docSlug,
      uploaderSlug,
      nextVersion: String(nextVersion),
      canonicalFileName: canonicalFileName ?? undefined,
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/versions`,
      error,
    );
  }
}

export async function downloadDocument(
  owner: string,
  repo: string,
  ref: string,
): Promise<Blob> {
  try {
    const response = await DocumentsClient.downloadDocument(owner, repo, {
      ref,
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/download`,
      error,
    );
  }
}

export async function listDocumentCollaborators(
  owner: string,
  repo: string,
  page = 1,
  limit = 12,
): Promise<CollaboratorListPayload> {
  try {
    const response = await DocumentsClient.listDocumentCollaborators(
      owner,
      repo,
      {
        page: String(page),
        limit: String(limit),
      },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/collaborators`,
      error,
    );
  }
}

export async function searchWorkspaceUsers(
  query: string,
  page = 1,
  limit = 8,
): Promise<SearchUsersPayload> {
  try {
    const response = await UsersClient.searchUsers({
      q: query,
      page: String(page),
      limit: String(limit),
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/users/search", error);
  }
}

export async function addDocumentCollaborator(
  owner: string,
  repo: string,
  collaborator: string,
  permission: "read" | "write" | "admin",
): Promise<
  | import("../../packages/gitea-client/repos").RepoCollaboratorPermissionSummary
  | null
> {
  try {
    const response = await DocumentsClient.addDocumentCollaborator(
      owner,
      repo,
      collaborator,
      { permission },
    );
    return response.data.collaborator ?? null;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/collaborators/${collaborator}`,
      error,
    );
  }
}

export async function removeDocumentCollaborator(
  owner: string,
  repo: string,
  collaborator: string,
): Promise<void> {
  try {
    await DocumentsClient.removeDocumentCollaborator(owner, repo, collaborator);
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/collaborators/${collaborator}`,
      error,
    );
  }
}

export async function getDocumentPermissions(
  owner: string,
  repo: string,
): Promise<DocumentPermissionsPayload> {
  try {
    const response = await DocumentsClient.getDocumentPermissions(owner, repo);
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/permissions`,
      error,
    );
  }
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
  try {
    const response = await DocumentsClient.updateDocumentPermissions(
      owner,
      repo,
      updates,
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/permissions`,
      error,
    );
  }
}

export async function submitDocumentReview(
  owner: string,
  repo: string,
  pullNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string,
): Promise<void> {
  try {
    await DocumentsClient.submitDocumentReview(
      owner,
      repo,
      String(pullNumber),
      { event, body },
    );
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/reviews`,
      error,
    );
  }
}

export async function publishDocument(
  owner: string,
  repo: string,
  pullNumber: number,
  nextVersion: number,
): Promise<{
  ok: boolean;
  tag: import("../../packages/gitea-client/repos").DocTag;
}> {
  try {
    const response = await DocumentsClient.publishDocument(
      owner,
      repo,
      String(pullNumber),
      { nextVersion },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/publish`,
      error,
    );
  }
}

// Billing functions

export async function fetchBillingStatus(): Promise<BillingStatusPayload> {
  const response = await BillingClient.getBillingStatus();
  return response.data;
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  const response = await BillingClient.createBillingCheckout({
    idempotencyKey: crypto.randomUUID(),
  });
  return response.data;
}

export async function createPortalSession(): Promise<{ url: string }> {
  const response = await BillingClient.createBillingPortal({
    idempotencyKey: crypto.randomUUID(),
  });
  return response.data;
}

// Admin functions

export async function listAdminSubscriptionAccess(
  query = "",
  page = 1,
  limit = 12,
): Promise<AdminSubscriptionAccessListPayload> {
  const response = await AdminClient.listAdminSubscriptionAccess({
    q: query,
    page: String(page),
    limit: String(limit),
  });
  return response.data;
}

export async function setAdminSubscriptionAccess(
  username: string,
  access: "grant" | "revoke",
): Promise<AdminSubscriptionAccessUser> {
  const response = await AdminClient.setAdminSubscriptionAccess(username, {
    access,
  });
  return response.data.user;
}

export async function clearAdminSubscriptionAccess(
  username: string,
): Promise<void> {
  await AdminClient.clearAdminSubscriptionAccess(username);
}

// Legacy functions (kept for backward compatibility but may not be used)

export interface AdminSubscriptionAccessState {
  username: string;
  hasProAccess: boolean;
  source: string | null;
  overrideActive: boolean | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function fetchAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  // This function was using a multi-attempt pattern which is no longer needed
  // with the new canonical /api/app/admin/subscriptions/access endpoint
  throw new Error(
    "fetchAdminSubscriptionAccess is deprecated - use listAdminSubscriptionAccess instead",
  );
}

export async function grantAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  await setAdminSubscriptionAccess(username, "grant");
  // Return a compatible structure
  return {
    username,
    hasProAccess: true,
    source: "admin_grant",
    overrideActive: true,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  };
}

export async function revokeAdminSubscriptionAccess(
  username: string,
): Promise<AdminSubscriptionAccessState> {
  await setAdminSubscriptionAccess(username, "revoke");
  // Return a compatible structure
  return {
    username,
    hasProAccess: false,
    source: "admin_revoke",
    overrideActive: true,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  };
}

// Validation helper
export function validateUploadFile(
  file: File,
): import("../../packages/gitea-client/uploads").UploadValidationResult {
  return validateUploadFileWithClient(file);
}

// Re-export token functions with original names
export function clearToken(): void {
  clearStoredToken();
}

export function storeToken(token: string): void {
  storeStoredToken(token);
}
