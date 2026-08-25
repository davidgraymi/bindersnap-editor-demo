import { z } from "zod";
import {
  DocTagSchema,
  RepoCollaboratorPermissionSummarySchema,
  WorkspaceRepoSchema,
} from "./common";

export const RepoBranchProtectionSchema = z.object({
  requiredApprovals: z.number(),
  enableApprovalsWhitelist: z.boolean(),
  approvalsWhitelistUsernames: z.array(z.string()),
  approvalsWhitelistTeams: z.array(z.string()),
  enableMergeWhitelist: z.boolean(),
  mergeWhitelistUsernames: z.array(z.string()),
  mergeWhitelistTeams: z.array(z.string()),
  blockOnRejectedReviews: z.boolean(),
  dismissStaleApprovals: z.boolean(),
});
export type RepoBranchProtection = z.infer<typeof RepoBranchProtectionSchema>;

export const ReviewSettingsSchema = z.object({
  blockOnUnresolvedThreads: z.boolean(),
});
export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;

export const DiscussionAuthorSchema = z.object({
  login: z.string(),
  fullName: z.string(),
  avatarUrl: z.string(),
});

export const DiscussionCommentSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  author: DiscussionAuthorSchema,
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  htmlUrl: z.string(),
});

export const DiscussionResolutionEventSchema = z.object({
  id: z.number(),
  actor: DiscussionAuthorSchema,
  resolved: z.boolean(),
  at: z.string(),
});

/**
 * One emoji on a thread, and who left it.
 *
 * `content` is Gitea's reaction name rather than an enum: the picker offers a
 * fixed six, but an instance configured with a wider `ALLOWED_REACTIONS` can
 * hold others, and the record shows what is actually there.
 */
export const ThreadReactionSchema = z.object({
  content: z.string(),
  count: z.number(),
  users: z.array(z.string()),
  reactedByViewer: z.boolean(),
});
export type ThreadReaction = z.infer<typeof ThreadReactionSchema>;

export const DiscussionThreadSchema = z.object({
  id: z.string(),
  origin: z.enum(["bindersnap", "external"]),
  comments: z.array(DiscussionCommentSchema),
  events: z.array(DiscussionResolutionEventSchema),
  reactions: z.array(ThreadReactionSchema),
  resolved: z.boolean(),
  resolvedBy: DiscussionAuthorSchema.nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DiscussionThread = z.infer<typeof DiscussionThreadSchema>;

export const DiscussionSummarySchema = z.object({
  threads: z.array(DiscussionThreadSchema),
  totalCount: z.number(),
  unresolvedCount: z.number(),
});
export type DiscussionSummary = z.infer<typeof DiscussionSummarySchema>;

export const CreateDiscussionBodySchema = z.object({
  body: z.string(),
});
export type CreateDiscussionBody = z.infer<typeof CreateDiscussionBodySchema>;

export const ResolveDiscussionBodySchema = z.object({
  resolved: z.boolean(),
});
export type ResolveDiscussionBody = z.infer<typeof ResolveDiscussionBodySchema>;

/**
 * The state the reader wants, not a flip. Two quick clicks on a toggle race
 * each other; asking for `reacted: true` twice is simply true.
 */
export const SetDiscussionReactionBodySchema = z.object({
  content: z.string(),
  reacted: z.boolean(),
});
export type SetDiscussionReactionBody = z.infer<
  typeof SetDiscussionReactionBodySchema
>;

export const CanonicalFileInfoSchema = z.object({
  storedFileName: z.string(),
  downloadFileName: z.string(),
});
export type CanonicalFileInfo = z.infer<typeof CanonicalFileInfoSchema>;

export const ApprovalStateSchema = z.enum([
  "working",
  "in_review",
  "changes_requested",
  "approved",
  "published",
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

/**
 * The approval record for one published version: who signed off, what they
 * said, and when. This is the audit trail the product exists to produce, so
 * every review is reported — including stale and dismissed ones.
 */
export const VersionReviewSchema = z.object({
  id: z.number(),
  author: DiscussionAuthorSchema,
  state: z.enum(["approved", "changes_requested", "commented", "other"]),
  body: z.string(),
  submittedAt: z.string(),
  stale: z.boolean(),
  dismissed: z.boolean(),
});
export type VersionReview = z.infer<typeof VersionReviewSchema>;

/**
 * A person attached to a change — the assignee, or someone asked to review.
 *
 * Same three fields the discussion already shows an author by, so a name
 * renders identically wherever it appears.
 */
export const ChangeUserSchema = DiscussionAuthorSchema;
export type ChangeUser = z.infer<typeof ChangeUserSchema>;

/**
 * Where one reviewer stands.
 *
 * "Awaiting" is the state that matters: it is the only one that names a person
 * the change is actually waiting on, and the whole reason a reviewer list beats
 * a single "in review" badge.
 */
export const ReviewerStatusSchema = z.enum([
  "approved",
  "changes_requested",
  "commented",
  "awaiting",
]);
export type ReviewerStatus = z.infer<typeof ReviewerStatusSchema>;

export const ChangeReviewerSchema = ChangeUserSchema.extend({
  status: ReviewerStatusSchema,
  /** When they last reviewed. Empty while their review is still awaited. */
  reviewedAt: z.string(),
  /** Their review no longer counts — a later upload superseded it. */
  stale: z.boolean(),
  /** They were explicitly asked, rather than turning up on their own. */
  requested: z.boolean(),
});
export type ChangeReviewer = z.infer<typeof ChangeReviewerSchema>;

export const PullRequestWithApprovalStateSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  created: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  branchName: z.string(),
  /** Approvals that still count, against the number the document demands. */
  approvalCount: z.number(),
  /**
   * How many approvals the document demands, or null when the policy could not
   * be read. 0 means the document genuinely demands none — the two are not the
   * same answer and the UI renders them differently.
   */
  requiredApprovals: z.number().nullable(),
  isApproved: z.boolean(),
  isRejected: z.boolean(),
  /** Who is on the hook to review, and where each of them stands. */
  reviewers: z.array(ChangeReviewerSchema),
  /** The one person answerable for the change, when someone is. */
  assignee: ChangeUserSchema.nullable(),
  body: z.string().optional(),
  approvalState: ApprovalStateSchema,
  user: z.object({ login: z.string() }).nullable().optional(),
  /**
   * The reviews on this change, oldest first. Only the document detail
   * populates it — a workspace list has no room for a review trail.
   */
  reviews: z.array(VersionReviewSchema).optional(),
});
export type PullRequestWithApprovalState = z.infer<
  typeof PullRequestWithApprovalStateSchema
>;

export const WorkspaceDocumentSummarySchema = z.object({
  repo: WorkspaceRepoSchema,
  latestTag: DocTagSchema.nullable(),
  pendingPRs: z.array(PullRequestWithApprovalStateSchema),
  error: z.string().nullable(),
});
export type WorkspaceDocumentSummary = z.infer<
  typeof WorkspaceDocumentSummarySchema
>;

export const DocumentDetailPayloadSchema = z.object({
  repository: WorkspaceRepoSchema,
  tags: z.array(DocTagSchema),
  latestTag: DocTagSchema.nullable(),
  openPullRequests: z.array(PullRequestWithApprovalStateSchema),
  uploadPullRequests: z.array(PullRequestWithApprovalStateSchema),
  branchProtection: RepoBranchProtectionSchema.nullable(),
  reviewSettings: ReviewSettingsSchema.nullable().optional(),
  canonicalFile: CanonicalFileInfoSchema.nullable(),
  currentUserPermission: RepoCollaboratorPermissionSummarySchema.nullable(),
});
export type DocumentDetailPayload = z.infer<typeof DocumentDetailPayloadSchema>;

export const InitialDocumentUploadResultSchema = z.object({
  repository: WorkspaceRepoSchema,
  owner: z.string(),
  repo: z.string(),
  canonicalFile: z.string(),
  prNumber: z.number(),
  prTitle: z.string(),
  branchName: z.string(),
  commitSha: z.string(),
});
export type InitialDocumentUploadResult = z.infer<
  typeof InitialDocumentUploadResultSchema
>;

export const UploadResultSchema = z.object({
  prNumber: z.number(),
  prTitle: z.string(),
  branchName: z.string(),
  commitSha: z.string(),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

export const CollaboratorListPayloadSchema = z.object({
  collaborators: z.array(RepoCollaboratorPermissionSummarySchema),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
  currentUserPermission: RepoCollaboratorPermissionSummarySchema.nullable(),
});
export type CollaboratorListPayload = z.infer<
  typeof CollaboratorListPayloadSchema
>;

export const DocumentPermissionsPayloadSchema = z.object({
  branchProtection: RepoBranchProtectionSchema.nullable(),
  isPrivate: z.boolean(),
  isInternal: z.boolean(),
  currentUserPermission:
    RepoCollaboratorPermissionSummarySchema.nullable().optional(),
  reviewSettings: ReviewSettingsSchema.nullable().optional(),
});
export type DocumentPermissionsPayload = z.infer<
  typeof DocumentPermissionsPayloadSchema
>;

export const UpdatePermissionsBodySchema = z.object({
  requiredApprovals: z.number().optional(),
  enableApprovalsWhitelist: z.boolean().optional(),
  approvalsWhitelistUsernames: z.array(z.string()).optional(),
  approvalsWhitelistTeams: z.array(z.string()).optional(),
  enableMergeWhitelist: z.boolean().optional(),
  mergeWhitelistUsernames: z.array(z.string()).optional(),
  mergeWhitelistTeams: z.array(z.string()).optional(),
  blockOnRejectedReviews: z.boolean().optional(),
  dismissStaleApprovals: z.boolean().optional(),
  blockOnUnresolvedThreads: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  isInternal: z.boolean().optional(),
});
export type UpdatePermissionsBody = z.infer<typeof UpdatePermissionsBodySchema>;

export const ReviewEventSchema = z.enum([
  "APPROVE",
  "REQUEST_CHANGES",
  "COMMENT",
]);

export const SubmitReviewBodySchema = z.object({
  event: ReviewEventSchema,
  body: z.string().optional(),
});
export type SubmitReviewBody = z.infer<typeof SubmitReviewBodySchema>;

export const PublishDocumentBodySchema = z.object({
  nextVersion: z.number(),
});
export type PublishDocumentBody = z.infer<typeof PublishDocumentBodySchema>;

export const PublishDocumentResultSchema = z.object({
  ok: z.boolean(),
  tag: DocTagSchema,
});
export type PublishDocumentResult = z.infer<typeof PublishDocumentResultSchema>;

export const AddCollaboratorBodySchema = z.object({
  permission: z.enum(["read", "write", "admin"]),
});
export type AddCollaboratorBody = z.infer<typeof AddCollaboratorBodySchema>;

export const VersionSubmissionSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  submittedBy: z.string(),
  submittedAt: z.string(),
  mergedAt: z.string().nullable(),
  mergedBy: z.string().nullable(),
});
export type VersionSubmission = z.infer<typeof VersionSubmissionSchema>;

export const DocumentVersionRecordSchema = z.object({
  version: z.number(),
  tagName: z.string(),
  sha: z.string(),
  createdAt: z.string(),
  /** Null when the version predates PR-based publishing or the PR was pruned. */
  submission: VersionSubmissionSchema.nullable(),
  reviews: z.array(VersionReviewSchema),
  discussionCount: z.number(),
});
export type DocumentVersionRecord = z.infer<typeof DocumentVersionRecordSchema>;

export const DocumentHistoryPayloadSchema = z.object({
  versions: z.array(DocumentVersionRecordSchema),
  canonicalFile: CanonicalFileInfoSchema.nullable(),
});
export type DocumentHistoryPayload = z.infer<
  typeof DocumentHistoryPayloadSchema
>;

/**
 * How a change stopped being open.
 *
 * "Closed" is not an outcome anyone can act on — an approval and an abandoned
 * draft both end up closed, and a reviewer looking back at the record needs to
 * know which one this was.
 */
export const ChangeOutcomeSchema = z.enum([
  "published",
  "declined",
  "withdrawn",
]);
export type ChangeOutcome = z.infer<typeof ChangeOutcomeSchema>;

export const ClosedChangeSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  /** The branch the submitted file lived on. Empty once Gitea prunes it. */
  branchName: z.string(),
  submittedBy: z.string(),
  submittedAt: z.string(),
  closedAt: z.string().nullable(),
  outcome: ChangeOutcomeSchema,
  /** Who published it, or who asked for changes it never came back from. */
  decidedBy: z.string().nullable(),
  /** The version this change became, when it was published. */
  publishedVersion: z.number().nullable(),
  /** Every review on the change, oldest first. */
  reviews: z.array(VersionReviewSchema),
  /** Who was asked to review it, and how each of them answered. */
  reviewers: z.array(ChangeReviewerSchema),
  assignee: ChangeUserSchema.nullable(),
  approvalCount: z.number(),
  /** As on an open change: null means unknown, 0 means none required. */
  requiredApprovals: z.number().nullable(),
});
export type ClosedChange = z.infer<typeof ClosedChangeSchema>;

export const ClosedChangesPayloadSchema = z.object({
  changes: z.array(ClosedChangeSchema),
});
export type ClosedChangesPayload = z.infer<typeof ClosedChangesPayloadSchema>;

/**
 * One update to what a change proposes.
 *
 * A change is not a single file — a submitter answers a reviewer by uploading
 * a corrected version, and that upload is a commit on the change's own branch.
 * Those commits *are* the updates, so nothing new is stored: this reads the
 * branch's history and numbers it. Update 1 is the original submission.
 */
export const ChangeUpdateSchema = z.object({
  /** 1-based position in the branch's history, oldest first. */
  index: z.number(),
  /** The commit the update landed as — the ref its file can be read at. */
  sha: z.string(),
  /** Who uploaded it, as Gitea recorded the commit author. */
  author: z.string(),
  at: z.string(),
});
export type ChangeUpdate = z.infer<typeof ChangeUpdateSchema>;

export const ChangeUpdatesPayloadSchema = z.object({
  /** Oldest first, so an index reads as the update number a person sees. */
  updates: z.array(ChangeUpdateSchema),
  /**
   * Whether an update wipes the approvals collected before it. This is Gitea's
   * `dismiss_stale_approvals` branch protection flag, so the timeline says
   * what actually happened rather than guessing.
   */
  resetsApprovals: z.boolean(),
});
export type ChangeUpdatesPayload = z.infer<typeof ChangeUpdatesPayloadSchema>;

/**
 * Who a change is on, and who has to sign it off.
 *
 * Both are optional by design: a change nobody has assigned still gets
 * reviewed, and the required-approval count still gates publishing. Naming
 * people only makes it obvious whose desk it is sitting on.
 */
export const UpdateChangeAssignmentsBodySchema = z.object({
  /** The person answerable for the change. `null` clears the assignment. */
  assignee: z.string().nullable().optional(),
  /**
   * The whole reviewer list, not a delta — anyone left out has their review
   * request withdrawn. Omit the field to leave reviewers alone.
   */
  reviewers: z.array(z.string()).optional(),
});
export type UpdateChangeAssignmentsBody = z.infer<
  typeof UpdateChangeAssignmentsBodySchema
>;

export const ChangeAssignmentsSchema = z.object({
  assignee: ChangeUserSchema.nullable(),
  reviewers: z.array(ChangeReviewerSchema),
  approvalCount: z.number(),
  /** As on an open change: null means unknown, 0 means none required. */
  requiredApprovals: z.number().nullable(),
});
export type ChangeAssignments = z.infer<typeof ChangeAssignmentsSchema>;
