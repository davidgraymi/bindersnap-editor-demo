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
  ChangeAssignments,
  ChangeUpdatesPayload,
  ClosedChangesPayload,
  CollaboratorListPayload,
  DiscussionSummary,
  DocumentDetailPayload,
  DocumentHistoryPayload,
  DocumentPermissionsPayload,
  InitialDocumentUploadResult,
  ReactionKind,
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
} from "../../packages/api-schema/schemas/admin";

// Re-export all generated types
export type {
  SessionAuthState,
  SessionUser,
} from "../../packages/api-schema/schemas/auth";
export type {
  ChangeAssignments,
  ChangeOutcome,
  CommentReaction,
  ChangeReviewer,
  ChangeUpdate,
  ChangeUpdatesPayload,
  ChangeUser,
  ClosedChange,
  ClosedChangesPayload,
  CollaboratorListPayload,
  DiscussionComment,
  DiscussionSummary,
  DiscussionThread,
  DocumentDetailPayload,
  DocumentHistoryPayload,
  DocumentPermissionsPayload,
  DocumentVersionRecord,
  WorkspaceDocumentSummary,
  InitialDocumentUploadResult,
  PullRequestWithApprovalState,
  ReactionKind,
  ReactionUser,
  ReviewerStatus,
  ReviewSettings,
  UploadResult,
  VersionReview,
  VersionSubmission,
} from "../../packages/api-schema/schemas/documents";
export type {
  AdminSubscriptionAccessListPayload,
  AdminSubscriptionAccessUser,
} from "../../packages/api-schema/schemas/admin";
export type {
  AdminSubscriptionAccessOverride,
  AdminSubscriptionAccessSource,
  BillingStatusPayload,
} from "../../packages/api-schema/schemas/billing";
export type { SearchUsersPayload } from "../../packages/api-schema/schemas/users";
export type {
  DocTag,
  RepoCollaboratorPermissionSummary,
  RepoUserSummary,
} from "../../packages/api-schema/schemas/common";
export type {
  ApprovalState,
  RepoBranchProtection,
} from "../../packages/api-schema/schemas/documents";

export interface UploadValidationResult {
  valid: boolean;
  reason?: string;
}

export type InitialDocumentUploadStep =
  | "hashing"
  | "creating-repo"
  | "bootstrapping"
  | "protecting"
  | "creating-branch"
  | "committing"
  | "opening-pr";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export function validateUploadFile(file: File): UploadValidationResult {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMiB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      reason: `File is too large (${sizeMiB} MiB). Maximum allowed size is 25 MiB.`,
    };
  }
  return { valid: true };
}

export { validateUploadFile as validateUploadFileWithClient };

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
    return response.status === 200 ? response.data : null;
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

export async function getDocumentHistory(
  owner: string,
  repo: string,
): Promise<DocumentHistoryPayload> {
  try {
    const response = await DocumentsClient.getDocumentHistory(owner, repo);
    return response.data;
  } catch (error) {
    handlePaymentRequired(`/api/app/documents/${owner}/${repo}/history`, error);
  }
}

/**
 * Changes that are no longer open. Fetched only when the reader asks for them
 * — the document page itself has no use for a closed change.
 */
export async function getClosedChanges(
  owner: string,
  repo: string,
): Promise<ClosedChangesPayload> {
  try {
    const response = await DocumentsClient.getClosedChanges(owner, repo);
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/changes/closed`,
      error,
    );
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
): Promise<RepoCollaboratorPermissionSummary | null> {
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
    dismissStaleApprovals?: boolean;
    blockOnUnresolvedThreads?: boolean;
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

/**
 * Put a change on someone's desk.
 *
 * `reviewers` is the whole list, not a delta — leave it out to change only the
 * assignee, and pass `assignee: null` to clear the assignment.
 */
export async function updateChangeAssignments(
  owner: string,
  repo: string,
  pullNumber: number,
  updates: { assignee?: string | null; reviewers?: string[] },
): Promise<ChangeAssignments> {
  try {
    const response = await DocumentsClient.updateChangeAssignments(
      owner,
      repo,
      String(pullNumber),
      updates,
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/assignments`,
      error,
    );
  }
}

/**
 * Every version this change has proposed.
 *
 * Separate from the change itself because the Changes tab has no use for it:
 * a list of changes does not need the history inside each one.
 */
export async function listChangeUpdates(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ChangeUpdatesPayload> {
  try {
    const response = await DocumentsClient.listChangeUpdates(
      owner,
      repo,
      String(pullNumber),
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/updates`,
      error,
    );
  }
}

export async function listDocumentDiscussions(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<DiscussionSummary> {
  try {
    const response = await DocumentsClient.listDocumentDiscussions(
      owner,
      repo,
      String(pullNumber),
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/discussions`,
      error,
    );
  }
}

export async function createDocumentDiscussion(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<DiscussionSummary> {
  try {
    const response = await DocumentsClient.createDocumentDiscussion(
      owner,
      repo,
      String(pullNumber),
      { body },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/discussions`,
      error,
    );
  }
}

export async function replyToDocumentDiscussion(
  owner: string,
  repo: string,
  pullNumber: number,
  threadId: string,
  body: string,
): Promise<DiscussionSummary> {
  try {
    const response = await DocumentsClient.replyToDocumentDiscussion(
      owner,
      repo,
      String(pullNumber),
      threadId,
      { body },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/discussions/${threadId}/comments`,
      error,
    );
  }
}

export async function resolveDocumentDiscussion(
  owner: string,
  repo: string,
  pullNumber: number,
  threadId: string,
  resolved: boolean,
): Promise<DiscussionSummary> {
  try {
    const response = await DocumentsClient.resolveDocumentDiscussion(
      owner,
      repo,
      String(pullNumber),
      threadId,
      { resolved },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/discussions/${threadId}/resolve`,
      error,
    );
  }
}

/**
 * Leave or take back one reaction on one review comment.
 *
 * Returns the whole discussion, like every other write here: the record the
 * page draws always comes back from the server rather than being patched
 * together on the client.
 */
export async function setDiscussionCommentReaction(
  owner: string,
  repo: string,
  pullNumber: number,
  threadId: string,
  commentId: number,
  content: ReactionKind,
  on: boolean,
): Promise<DiscussionSummary> {
  try {
    const response = await DocumentsClient.setDiscussionCommentReaction(
      owner,
      repo,
      String(pullNumber),
      threadId,
      String(commentId),
      { content, on },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/documents/${owner}/${repo}/pull-requests/${pullNumber}/discussions/${threadId}/comments/${commentId}/reactions`,
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
  tag: DocTag;
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
  try {
    const response = await BillingClient.getBillingStatus();
    return response.data;
  } catch (error) {
    // 402 from the billing endpoint contains billing data (e.g. past_due status),
    // not a payment gate. Return the parsed body instead of throwing.
    if (
      error instanceof ApiRequestError &&
      error.status === 402 &&
      error.data
    ) {
      return error.data as BillingStatusPayload;
    }
    throw error;
  }
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
