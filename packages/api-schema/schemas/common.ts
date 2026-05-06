import { z } from "zod";

export const RepoUserSummarySchema = z.object({
  id: z.number(),
  login: z.string(),
  full_name: z.string(),
  email: z.string(),
  avatar_url: z.string(),
});
export type RepoUserSummary = z.infer<typeof RepoUserSummarySchema>;

export const RepoCollaboratorRoleSchema = z.enum(["read", "write", "admin"]);
export type RepoCollaboratorRole = z.infer<typeof RepoCollaboratorRoleSchema>;

export const RepoCollaboratorPermissionSummarySchema = z.object({
  permission: z.string(),
  access: RepoCollaboratorRoleSchema,
  permissionLabel: z.string(),
  roleName: z.string(),
  user: RepoUserSummarySchema,
});
export type RepoCollaboratorPermissionSummary = z.infer<
  typeof RepoCollaboratorPermissionSummarySchema
>;

export const WorkspaceRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  description: z.string(),
  updated_at: z.string(),
  owner: z.object({ login: z.string() }),
});
export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;

export const DocTagSchema = z.object({
  name: z.string(),
  version: z.number(),
  sha: z.string(),
  created: z.string(),
});
export type DocTag = z.infer<typeof DocTagSchema>;
