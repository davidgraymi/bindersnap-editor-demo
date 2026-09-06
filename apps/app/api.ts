// Re-export document search utilities
export type { DocumentSearchParams } from "./documentSearch";
export { parseDocumentSearchQuery } from "./documentSearch";

// Import generated API functions
import * as AuthClient from "../../packages/api-client/auth/auth";
import * as DocumentsClient from "../../packages/api-client/documents/documents";
import * as UsersClient from "../../packages/api-client/users/users";
import * as BillingClient from "../../packages/api-client/billing/billing";
import * as AdminClient from "../../packages/api-client/admin/admin";
import * as OrganizationsClient from "../../packages/api-client/organizations/organizations";
import * as BindersClient from "../../packages/api-client/workspaces/workspaces";
import type {
  CreatedWorkspaceDocumentPayload,
  PublishedWorkspaceChangePayload,
  WorkspaceChangeDetailPayload,
  WorkspaceDocumentDetailPayload,
  WorkspaceDocumentListPayload,
  WorkspaceSummary,
} from "../../packages/api-schema/schemas/workspaces";

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
  DocumentSearchResultsPayload,
  HomeChangesPayload,
  HomeDecidedDocument,
  HomeOpenDocument,
  InitialDocumentUploadResult,
  ReactionKind,
  UploadResult,
  WorkspaceDocumentSummary,
} from "../../packages/api-schema/schemas/documents";
import type { SearchUsersPayload } from "../../packages/api-schema/schemas/users";
import type {
  CreatedOrganizationPayload,
  OrganizationSummary,
} from "../../packages/api-schema/schemas/organizations";
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
  DocumentSearchResultsPayload,
  DocumentVersionRecord,
  HomeChangesPayload,
  HomeDecidedDocument,
  HomeOpenDocument,
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
  WorkspaceRepo,
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

/** One page of the library. Each row costs Gitea reads, so it is asked for in pages. */
export interface WorkspaceDocumentsPage {
  documents: WorkspaceDocumentSummary[];
  page: number;
  hasMore: boolean;
}

export async function getWorkspaceDocuments(
  params?: DocumentSearchParams & { page?: number; limit?: number },
): Promise<WorkspaceDocumentsPage> {
  try {
    const response = await DocumentsClient.listDocuments({
      owner: params?.ownerUsername,
      member: params?.memberUsername,
      q: params?.freeText,
      page: params?.page,
      limit: params?.limit,
    });
    return {
      documents: response.data.documents ?? [],
      page: response.data.page ?? params?.page ?? 1,
      hasMore: response.data.hasMore ?? false,
    };
  } catch (error) {
    handlePaymentRequired("/api/app/documents", error);
  }
}

/**
 * Every change the reader is part of, open and recently decided.
 *
 * One request. Home used to ask for the whole workspace and then ask each
 * document for its closed changes, which cost a round trip per document to
 * render a handful of rows.
 */
export async function getHomeChanges(): Promise<HomeChangesPayload> {
  try {
    const response = await DocumentsClient.getHomeChanges();
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/home/changes", error);
  }
}

/**
 * One page of quick-find matches: repo rows only, no per-document fan-out.
 *
 * The panel calls this on every settled keystroke and again for each page the
 * reader scrolls into, so it stays deliberately cheap. The library listing is
 * still the call that knows about versions and open changes.
 */
export async function searchDocuments(
  query: string,
  page = 1,
  limit = 8,
): Promise<DocumentSearchResultsPayload> {
  try {
    const response = await DocumentsClient.searchDocuments({
      q: query,
      page: String(page),
      limit: String(limit),
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/documents/search", error);
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

// Organization functions

/**
 * The organizations this session belongs to.
 *
 * An empty list is an ordinary answer, not an error: an account that predates
 * ADR 0004, or one whose owner has not created an organization yet, has none.
 */
export async function fetchOrganizations(): Promise<OrganizationSummary[]> {
  const response = await OrganizationsClient.listOrganizations();
  return response.data.organizations;
}

export async function createOrganization(
  name: string,
): Promise<CreatedOrganizationPayload["organization"]> {
  const response = await OrganizationsClient.createOrganization({ name });
  return response.data.organization;
}

// Binder functions

/**
 * Every binder this session can act in, across every organization it belongs
 * to — each one naming its owner, because that is what its address needs.
 */
export async function fetchBinders(): Promise<WorkspaceSummary[]> {
  const response = await BindersClient.listBinders();
  return response.data.workspaces;
}

/**
 * The binders one organization owns.
 *
 * Distinct from `fetchBinders`, which answers a question about a person —
 * everything I can act in, wherever it lives. This answers a question about an
 * organization, which is what you are asking when you are looking at the
 * organization rather than at your day.
 */
export async function fetchOrganizationBinders(
  org: string,
): Promise<WorkspaceSummary[]> {
  const response = await BindersClient.listOrganizationBinders(org);
  return response.data.workspaces;
}

export async function createBinder(
  org: string,
  name: string,
  description?: string,
): Promise<WorkspaceSummary> {
  const response = await BindersClient.createBinder(org, {
    name,
    description,
  });
  return response.data.workspace;
}

export async function fetchBinderDocuments(
  org: string,
  binder: string,
): Promise<WorkspaceDocumentListPayload> {
  const response = await BindersClient.listBinderDocuments(org, binder);
  return response.data;
}

export async function fetchBinderDocument(
  org: string,
  binder: string,
  documentPath: string,
): Promise<WorkspaceDocumentDetailPayload> {
  const response = await BindersClient.getBinderDocument(
    org,
    binder,
    documentPath,
  );
  return response.data;
}

/**
 * One change in a binder — what it proposes, and where it stands.
 *
 * A question about the change rather than about a document, because the change
 * is the unit of approval: publishing one that touched three policies versions
 * all three.
 */
export async function fetchBinderChange(
  org: string,
  binder: string,
  changeNumber: number,
): Promise<WorkspaceChangeDetailPayload> {
  const response = await BindersClient.getBinderChange(
    org,
    binder,
    String(changeNumber),
  );
  return response.data;
}

/** Approve a change, ask for work on it, or say something about it. */
export async function reviewBinderChange(
  org: string,
  binder: string,
  changeNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string,
): Promise<void> {
  try {
    await BindersClient.reviewBinderChange(org, binder, String(changeNumber), {
      event,
      ...(body ? { body } : {}),
    });
  } catch (error) {
    handlePaymentRequired(
      `/api/app/binders/${org}/${binder}/changes/${changeNumber}/reviews`,
      error,
    );
  }
}

/**
 * Bring a change's branch up to date with the binder's `main`.
 *
 * It moves the branch, so a binder that dismisses stale approvals will drop
 * the ones already collected — which is why this is its own act rather than
 * something publish does quietly.
 */
export async function updateBinderChange(
  org: string,
  binder: string,
  changeNumber: number,
): Promise<void> {
  try {
    await BindersClient.updateBinderChange(org, binder, String(changeNumber));
  } catch (error) {
    handlePaymentRequired(
      `/api/app/binders/${org}/${binder}/changes/${changeNumber}/update`,
      error,
    );
  }
}

/** Merge the change and tag a version for every document it touched. */
export async function publishBinderChange(
  org: string,
  binder: string,
  changeNumber: number,
): Promise<PublishedWorkspaceChangePayload> {
  try {
    const response = await BindersClient.publishBinderChange(
      org,
      binder,
      String(changeNumber),
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `/api/app/binders/${org}/${binder}/changes/${changeNumber}/publish`,
      error,
    );
  }
}

/**
 * Add a document to a binder — the ADR 0004 upload path.
 *
 * A mutation, so it is behind the paywall; the 402 is intercepted here so a
 * delinquent organization gets the banner rather than a raw error under the
 * file picker.
 */
export async function createBinderDocument(
  org: string,
  binder: string,
  file: File,
  name: string,
  folder?: string,
): Promise<CreatedWorkspaceDocumentPayload> {
  try {
    const response = await BindersClient.createBinderDocument(org, binder, {
      file,
      name,
      ...(folder ? { folder } : {}),
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired(`/api/app/binders/${org}/${binder}/documents`, error);
  }
}

/**
 * The bytes of one document in a binder, at a ref.
 *
 * `ref` is a version tag for a published version, or a change's branch for one
 * still under review. Unstated means `main` — the version on record.
 */
export async function downloadBinderDocument(
  org: string,
  binder: string,
  documentPath: string,
  ref?: string,
): Promise<Blob> {
  const response = await BindersClient.downloadBinderDocument(
    org,
    binder,
    documentPath,
    ref ? { ref } : undefined,
  );
  return response.data;
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
