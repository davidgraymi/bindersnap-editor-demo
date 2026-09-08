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
  BinderGroupsPayload,
  BinderPeoplePayload,
  CreatedOrganizationGroupPayload,
  LibraryPayload,
  LibrarySearchPayload,
  OrganizationPeoplePayload,
  PublishedWorkspaceChangePayload,
  WorkspaceChangeDetailPayload,
  WorkspaceChangeListPayload,
  WorkspaceHistoryEntry,
  WorkspaceHistoryPayload,
  WorkspaceOverviewPayload,
  WorkspaceSettingsPayload,
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
export type {
  WorkspaceHistoryEntry,
  LibraryDocument,
  LibraryPayload,
  LibrarySearchPayload,
  WorkspaceSummary,
} from "../../packages/api-schema/schemas/workspaces";

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
import { isPaywallResponse, notifyPaymentRequired } from "./paymentRequired";
import type { DocumentSearchParams } from "./documentSearch";
import type { ChangeScope } from "./changeScope";
import { scopeChangeBase, scopeRepo } from "./changeScope";

/**
 * Turn a refused write into read-only mode.
 *
 * `path` is kept for the call sites that read as documentation of which
 * endpoint they front, but it no longer decides anything: whether a 402 is
 * the paywall is the body's answer now, not the URL's.
 */
function handlePaymentRequired(path: string, error: unknown): never {
  void path;
  if (
    error instanceof ApiRequestError &&
    error.status === 402 &&
    isPaywallResponse(error.data)
  ) {
    notifyPaymentRequired({
      organizationName: error.data.organization ?? null,
    });
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

/**
 * The library: every policy in every binder this person can reach.
 *
 * **Rebuilt on binders.** It used to search Gitea for *repositories*, because a
 * document was one — so the page's saved views ("mine", "everyone's") and its
 * owner filters were questions about who owned a repo. Nobody owns a document
 * now: the organization owns the binder and the binder holds the policy, so
 * those questions no longer exist and are gone rather than reinterpreted into
 * something that would quietly mean something else.
 *
 * Unpaged, deliberately. The server reads each binder once — three calls per
 * binder, whatever it holds — so there is no cheaper page to fetch: paging it
 * would mean doing the same work again for every page.
 */
export async function fetchLibrary(query?: string): Promise<LibraryPayload> {
  try {
    const response = await DocumentsClient.listDocuments(
      query ? { q: query } : {},
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/documents", error);
  }
}

export async function getHomeChanges(): Promise<HomeChangesPayload> {
  try {
    const response = await DocumentsClient.getHomeChanges();
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/home/changes", error);
  }
}

/**
 * Quick-find matches, capped.
 *
 * The same question the library asks, asked shorter, and answered by the same
 * server-side read — so the two cannot disagree about which binders count.
 * There is no page to ask for: the read walks every binder once, so a second
 * page would repeat the whole thing. It returns the best few and says whether
 * there were more.
 */
export async function searchDocuments(
  query: string,
  limit = 8,
): Promise<LibrarySearchPayload> {
  try {
    const response = await DocumentsClient.searchDocuments({
      q: query,
      limit: String(limit),
    });
    return response.data;
  } catch (error) {
    handlePaymentRequired("/api/app/documents/search", error);
  }
}

/** The bytes of the document this change is about, at a ref. */
export async function downloadDocument(
  scope: ChangeScope,
  ref: string,
): Promise<Blob> {
  return downloadBinderDocument(
    scope.org,
    scope.binder,
    scope.documentPath,
    ref,
  );
}

export async function listDocumentCollaborators(
  scope: ChangeScope,
  page = 1,
  limit = 12,
): Promise<CollaboratorListPayload> {
  const query = { page: String(page), limit: String(limit) };
  try {
    const response = await BindersClient.listBinderCollaborators(
      scope.org,
      scope.binder,
      query,
    );
    return response.data;
  } catch (error) {
    const { owner, repo } = scopeRepo(scope);
    handlePaymentRequired(
      `/api/app/binders/${owner}/${repo}/collaborators`,
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

export async function submitDocumentReview(
  scope: ChangeScope,
  pullNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body?: string,
): Promise<void> {
  try {
    await BindersClient.reviewBinderChange(
      scope.org,
      scope.binder,
      String(pullNumber),
      { event, ...(body ? { body } : {}) },
    );
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/reviews`,
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
  scope: ChangeScope,
  pullNumber: number,
  updates: { assignee?: string | null; reviewers?: string[] },
): Promise<ChangeAssignments> {
  try {
    const response = await BindersClient.updateBinderChangeAssignments(
      scope.org,
      scope.binder,
      String(pullNumber),
      updates,
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/assignments`,
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
  scope: ChangeScope,
  pullNumber: number,
): Promise<ChangeUpdatesPayload> {
  try {
    const response = await BindersClient.listBinderChangeUpdates(
      scope.org,
      scope.binder,
      String(pullNumber),
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/updates`,
      error,
    );
  }
}

export async function listChangeDiscussions(
  scope: ChangeScope,
  pullNumber: number,
): Promise<DiscussionSummary> {
  try {
    const response = await BindersClient.listBinderChangeDiscussions(
      scope.org,
      scope.binder,
      String(pullNumber),
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/discussions`,
      error,
    );
  }
}

export async function createChangeDiscussion(
  scope: ChangeScope,
  pullNumber: number,
  body: string,
): Promise<DiscussionSummary> {
  try {
    const response = await BindersClient.createBinderChangeDiscussion(
      scope.org,
      scope.binder,
      String(pullNumber),
      { body },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/discussions`,
      error,
    );
  }
}

export async function replyToChangeDiscussion(
  scope: ChangeScope,
  pullNumber: number,
  threadId: string,
  body: string,
): Promise<DiscussionSummary> {
  try {
    const response = await BindersClient.replyToBinderChangeDiscussion(
      scope.org,
      scope.binder,
      String(pullNumber),
      threadId,
      { body },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/discussions/${threadId}/comments`,
      error,
    );
  }
}

export async function resolveChangeDiscussion(
  scope: ChangeScope,
  pullNumber: number,
  threadId: string,
  resolved: boolean,
): Promise<DiscussionSummary> {
  try {
    const response = await BindersClient.resolveBinderChangeDiscussion(
      scope.org,
      scope.binder,
      String(pullNumber),
      threadId,
      { resolved },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/discussions/${threadId}/resolve`,
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
  scope: ChangeScope,
  pullNumber: number,
  threadId: string,
  commentId: number,
  content: ReactionKind,
  on: boolean,
): Promise<DiscussionSummary> {
  try {
    const response = await BindersClient.setBinderDiscussionCommentReaction(
      scope.org,
      scope.binder,
      String(pullNumber),
      threadId,
      String(commentId),
      { content, on },
    );
    return response.data;
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/discussions/${threadId}/comments/${commentId}/reactions`,
      error,
    );
  }
}

/**
 * Publish a change: merge it, and write the version it becomes.
 *
 * `nextVersion` is only the document model's to state. A binder works out one
 * version per document the change touched — three documents, three tags on one
 * commit — so it is told nothing and answers with what it wrote.
 */
export async function publishDocument(
  scope: ChangeScope,
  pullNumber: number,
  nextVersion: number,
): Promise<void> {
  try {
    await BindersClient.publishBinderChange(
      scope.org,
      scope.binder,
      String(pullNumber),
    );
  } catch (error) {
    handlePaymentRequired(
      `${scopeChangeBase(scope, pullNumber)}/publish`,
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
  /** Whether the whole organization can read it. Asked on the form. */
  openToOrganization = true,
): Promise<WorkspaceSummary> {
  const response = await BindersClient.createBinder(org, {
    name,
    description,
    openToOrganization,
  });
  return response.data.workspace;
}

/** The binder itself: what it is called, what it is for, how much is in it. */
export async function fetchBinder(
  org: string,
  binder: string,
): Promise<WorkspaceOverviewPayload> {
  const response = await BindersClient.getBinder(org, binder);
  return response.data;
}

/** The binder's change requests, open or closed. */
export async function fetchBinderChanges(
  org: string,
  binder: string,
  state: "open" | "closed" = "open",
): Promise<WorkspaceChangeListPayload> {
  const response = await BindersClient.listBinderChanges(org, binder, {
    state,
  });
  return response.data;
}

/**
 * Propose new per-folder sign-off rules.
 *
 * **Returns a change, not a success.** `main` is protected, so the rules that
 * decide who approves are themselves approved — and a caller holding a change
 * number cannot report otherwise. The whole set is sent rather than a patch:
 * the file is regenerated from what arrives, so omitting a rule would delete
 * it, and sending everything makes that impossible to do by accident.
 */
export async function proposeBinderSignOff(
  org: string,
  binder: string,
  rules: Array<{ folder: string; teams: string[]; users: string[] }>,
): Promise<{ changeNumber: number; branch: string }> {
  const response = await BindersClient.proposeBinderSignOffRules(org, binder, {
    rules,
  });
  return response.data;
}

/** Who is in this organization, and the groups it has. */
export async function fetchOrganizationPeople(
  org: string,
): Promise<OrganizationPeoplePayload> {
  const response = await OrganizationsClient.getOrganizationPeople(org);
  return response.data;
}

/**
 * Name a group and level it, which is one act.
 *
 * A Gitea team carries one unit map, so the level belongs to the group rather
 * than to the grant — a group cannot be an editor in one binder and a reviewer
 * in another. Asking for the two together is how that constraint is shown
 * rather than discovered.
 */
export async function createOrganizationGroup(
  org: string,
  name: string,
  level: string,
): Promise<CreatedOrganizationGroupPayload> {
  const response = await OrganizationsClient.createOrganizationGroup(org, {
    name,
    level,
  });
  return response.data;
}

/**
 * Promote somebody to owner, or demote them back to member.
 *
 * Refused with a sentence when it would leave the organization with no owner —
 * the same sentence removal is refused with, because they are two routes to one
 * consequence.
 */
export async function setOrganizationPersonRole(
  org: string,
  username: string,
  owner: boolean,
): Promise<OrganizationPeoplePayload> {
  const response = await OrganizationsClient.setOrganizationPersonRole(
    org,
    username,
    { owner },
  );
  return response.data;
}

/**
 * Take somebody out of the organization.
 *
 * They lose access immediately, everywhere — and everything they wrote,
 * approved or commented on stays exactly where it is, because those are git
 * objects and the record belongs to the organization.
 */
export async function removeOrganizationPerson(
  org: string,
  username: string,
): Promise<OrganizationPeoplePayload> {
  const response = await OrganizationsClient.removeOrganizationPerson(
    org,
    username,
  );
  return response.data;
}

/** Put somebody in a group. Immediate: no commit, no approval. */
export async function addOrganizationGroupMember(
  org: string,
  group: string,
  username: string,
): Promise<OrganizationPeoplePayload> {
  const response = await OrganizationsClient.addOrganizationGroupMember(
    org,
    group,
    { username },
  );
  return response.data;
}

export async function removeOrganizationGroupMember(
  org: string,
  group: string,
  username: string,
): Promise<OrganizationPeoplePayload> {
  const response = await OrganizationsClient.removeOrganizationGroupMember(
    org,
    group,
    username,
  );
  return response.data;
}

/**
 * Compose a group onto this binder, and rewrite the approvals whitelist.
 *
 * Both halves are one call because the second fails silently on its own: a
 * granted team missing from the whitelist has its members' approvals recorded,
 * displayed, and satisfying nothing.
 */
export async function grantBinderGroup(
  org: string,
  binder: string,
  group: string,
): Promise<BinderGroupsPayload> {
  const response = await BindersClient.grantBinderGroup(org, binder, { group });
  return response.data;
}

export async function revokeBinderGroup(
  org: string,
  binder: string,
  group: string,
): Promise<BinderGroupsPayload> {
  const response = await BindersClient.revokeBinderGroup(org, binder, group);
  return response.data;
}

/** Who can act in this binder, one row per person. */
export async function fetchBinderPeople(
  org: string,
  binder: string,
): Promise<BinderPeoplePayload> {
  const response = await BindersClient.getBinderPeople(org, binder);
  return response.data;
}

/**
 * Add somebody to this binder at a level.
 *
 * Also the escape hatch for one person in a group who needs more here: an
 * individual grant sits alongside the group rather than changing it, so it
 * touches this binder and no other.
 */
export async function addBinderPerson(
  org: string,
  binder: string,
  username: string,
  level: string,
): Promise<BinderPeoplePayload> {
  const response = await BindersClient.addBinderPerson(org, binder, {
    username,
    level,
  });
  return response.data;
}

/**
 * Move somebody between this binder's levels.
 *
 * Refused with a sentence when their access comes from a shared group — that
 * group is one object across every binder it reaches, so the change is not this
 * binder's to make.
 */
export async function setBinderPersonLevel(
  org: string,
  binder: string,
  username: string,
  level: string,
): Promise<BinderPeoplePayload> {
  const response = await BindersClient.setBinderPersonLevel(
    org,
    binder,
    username,
    { username, level },
  );
  return response.data;
}

export async function removeBinderPerson(
  org: string,
  binder: string,
  username: string,
): Promise<BinderPeoplePayload> {
  const response = await BindersClient.removeBinderPerson(
    org,
    binder,
    username,
  );
  return response.data;
}

/**
 * Open this binder to the whole organization, or close it again.
 *
 * One switch over one primitive — `staff` granted onto the repository, or not —
 * and its own call rather than a group grant with a friendlier name, because
 * "everyone at Riverside Health can read this" is a decision about the binder
 * and not housekeeping about a team.
 */
export async function setBinderVisibility(
  org: string,
  binder: string,
  openToOrganization: boolean,
): Promise<BinderPeoplePayload> {
  const response = await BindersClient.setBinderVisibility(org, binder, {
    openToOrganization,
  });
  return response.data;
}

/** Every version this binder has published, newest first. */
export async function fetchBinderHistory(
  org: string,
  binder: string,
): Promise<WorkspaceHistoryPayload> {
  const response = await BindersClient.getBinderHistory(org, binder);
  return response.data;
}

/** Who can act in this binder, and the rules it is governed by. */
export async function fetchBinderSettings(
  org: string,
  binder: string,
): Promise<WorkspaceSettingsPayload> {
  const response = await BindersClient.getBinderSettings(org, binder);
  return response.data;
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
