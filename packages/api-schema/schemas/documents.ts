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
});
export type RepoBranchProtection = z.infer<typeof RepoBranchProtectionSchema>;

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

export const PullRequestWithApprovalStateSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  created: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  branchName: z.string(),
  approvalCount: z.number(),
  requiredApprovals: z.number(),
  isApproved: z.boolean(),
  isRejected: z.boolean(),
  reviewers: z.array(z.string()),
  body: z.string().optional(),
  approvalState: ApprovalStateSchema,
  user: z.object({ login: z.string() }).nullable().optional(),
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
