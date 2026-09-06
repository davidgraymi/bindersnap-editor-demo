import { z } from "zod";

import { PullRequestWithApprovalStateSchema } from "./documents";

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

/**
 * Whether the binder actually holds this document yet.
 *
 * `main` is the record, so a policy somebody uploaded an hour ago is not in
 * it — and a binder that silently omits what you just added looks broken in
 * the one moment you are watching. `proposed` is that document: real, filed
 * at a real address, waiting on a decision.
 */
export const WorkspaceDocumentStateSchema = z.enum(["published", "proposed"]);
export type WorkspaceDocumentState = z.infer<
  typeof WorkspaceDocumentStateSchema
>;

/**
 * A document as the binder's list shows it.
 *
 * The published version is here because a list of policies that does not say
 * which version each one is at answers none of the questions a list is opened
 * to answer. It costs one tags call for the whole binder — the tags are
 * repository-global — rather than one per document.
 *
 * Not an extension of `WorkspaceDocumentEntrySchema`, because that describes a
 * file that exists and this list also carries documents that do not exist on
 * `main` yet. What a row needs is its identity, and it has that either way.
 */
export const WorkspaceDocumentListEntrySchema = z.object({
  /**
   * `clinical/infection-control.pdf` — where the file is, or **null** for a
   * document that so far exists only inside an open change.
   *
   * The extension lives in the file, so learning it for a proposed document
   * means walking that change's tree — a call per document, which is the cost
   * the binder model exists to remove. A row does not need it: it is addressed
   * by `slugPath`, and the document's own page pays for the exact path once.
   */
  path: z.string().nullable(),
  /** `clinical/infection-control` — the document's identity, always known. */
  slugPath: z.string(),
  name: z.string(),
  /** `clinical`, or "" at the binder's root. */
  folder: z.string(),
  /** Null for a proposed document, for the same reason as `path`. */
  size: z.number().nullable(),
  /** Null for a proposed document, for the same reason as `path`. */
  sha: z.string().nullable(),
  state: WorkspaceDocumentStateSchema,
  /** Open changes touching this document. Decides a badge, nothing more. */
  openChangeCount: z.number(),
  /** The version on record, or null for a document nobody has published. */
  latestVersion: DocumentVersionSchema.nullable(),
});
export type WorkspaceDocumentListEntry = z.infer<
  typeof WorkspaceDocumentListEntrySchema
>;

export const WorkspaceDocumentListPayloadSchema = z.object({
  organization: z.string().optional(),
  workspace: z.string(),
  documents: z.array(WorkspaceDocumentListEntrySchema),
});
export type WorkspaceDocumentListPayload = z.infer<
  typeof WorkspaceDocumentListPayloadSchema
>;

export const WorkspaceDocumentDetailPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  document: WorkspaceDocumentEntrySchema,
  state: WorkspaceDocumentStateSchema,
  /**
   * The git ref the document's file is readable at.
   *
   * `main` for a published document. For one that is only proposed it is the
   * change's own branch — which is the whole reason this field exists: without
   * it the page would have to guess, and `main` has nothing to give it.
   */
  ref: z.string(),
  /** Newest first. */
  versions: z.array(DocumentVersionSchema),
  latestVersion: DocumentVersionSchema.nullable(),
  /**
   * The open changes touching this document, newest first.
   *
   * The same shape the per-document workspace uses, deliberately: a change is
   * a change wherever it is shown, and a second type for it would mean a
   * second set of status wording to keep in step.
   */
  openChanges: z.array(PullRequestWithApprovalStateSchema),
});
export type WorkspaceDocumentDetailPayload = z.infer<
  typeof WorkspaceDocumentDetailPayloadSchema
>;
