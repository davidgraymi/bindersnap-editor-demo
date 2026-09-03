import { z } from "zod";

/**
 * ADR 0004's second level: the binder.
 *
 * A workspace is a Gitea repository owned by the organization — "everything a
 * workspace has to be, a repository already is". It carries the rules
 * (branch protection on `main`), the people (the three role teams granted onto
 * it), and eventually the documents (files in its tree).
 *
 * Organizations no longer arrive with one. Naming the container a customer's
 * records live in is the owner's decision, so making a workspace is something a
 * member does — which is what these two operations are for.
 */

export const WorkspaceSummarySchema = z.object({
  /** The Gitea repository id. The only stable identifier: repos get renamed. */
  id: z.number(),
  /** The repository name — a URL segment, slugified from what they typed. */
  name: z.string(),
  /** The owning organization's Gitea username. */
  owner: z.string(),
  /** `owner/name`, as Gitea addresses it. */
  fullName: z.string(),
  description: z.string(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceListPayloadSchema = z.object({
  workspaces: z.array(WorkspaceSummarySchema),
});
export type WorkspaceListPayload = z.infer<typeof WorkspaceListPayloadSchema>;

export const NewWorkspaceBodySchema = z.object({
  /** What to call it. Slugified server-side into the repository name. */
  name: z.string().min(1),
  description: z.string().optional(),
});
export type NewWorkspaceBody = z.infer<typeof NewWorkspaceBodySchema>;

export const CreatedWorkspacePayloadSchema = z.object({
  workspace: WorkspaceSummarySchema,
});
export type CreatedWorkspacePayload = z.infer<
  typeof CreatedWorkspacePayloadSchema
>;

/**
 * Where a document landed, and the change that will publish it.
 *
 * ADR 0004's step 2: the document is a file at a path inside the binder, not a
 * repository of its own. `slugPath` is that path without its extension — the
 * document's identity, and what its version tags are namespaced under.
 */
export const CreatedWorkspaceDocumentPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  /** `clinical/infection-control.pdf` — where the file is. */
  documentPath: z.string(),
  /** `clinical/infection-control` — what the document is called. */
  slugPath: z.string(),
  branch: z.string(),
  pullRequestNumber: z.number().nullable(),
});
export type CreatedWorkspaceDocumentPayload = z.infer<
  typeof CreatedWorkspaceDocumentPayloadSchema
>;

/** A document as the binder holds it: a file at a path. */
export const WorkspaceDocumentEntrySchema = z.object({
  /** `clinical/infection-control.pdf` — where the file is. */
  path: z.string(),
  /** `clinical/infection-control` — the document's identity. */
  slugPath: z.string(),
  name: z.string(),
  /** `clinical`, or "" at the binder's root. */
  folder: z.string(),
  size: z.number(),
  sha: z.string(),
});
export type WorkspaceDocumentEntry = z.infer<
  typeof WorkspaceDocumentEntrySchema
>;

/**
 * A published version.
 *
 * The tag is the evidence: tag → commit → pull request → reviews is what makes
 * "who approved v4" answerable exactly.
 */
export const DocumentVersionSchema = z.object({
  tag: z.string(),
  version: z.number(),
  commitSha: z.string(),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const WorkspaceDocumentListPayloadSchema = z.object({
  organization: z.string().optional(),
  workspace: z.string(),
  documents: z.array(
    WorkspaceDocumentEntrySchema.extend({
      /** Open changes touching this document. Decides a badge, nothing more. */
      openChangeCount: z.number(),
    }),
  ),
});
export type WorkspaceDocumentListPayload = z.infer<
  typeof WorkspaceDocumentListPayloadSchema
>;

export const WorkspaceDocumentDetailPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  document: WorkspaceDocumentEntrySchema,
  /** Newest first. */
  versions: z.array(DocumentVersionSchema),
  latestVersion: DocumentVersionSchema.nullable(),
  openChanges: z.array(z.unknown()),
});
export type WorkspaceDocumentDetailPayload = z.infer<
  typeof WorkspaceDocumentDetailPayloadSchema
>;
