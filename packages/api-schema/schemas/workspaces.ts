import { z } from "zod";

import {
  ChangeReviewerSchema,
  ChangeUserSchema,
  PullRequestWithApprovalStateSchema,
  VersionReviewSchema,
} from "./documents";

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

/**
 * One document a change touches, and what publishing would make of it.
 *
 * The version is per document because a binder's documents do not advance in
 * lockstep: one change publishing three documents writes `v4`, `v2` and `v7`
 * onto the same commit, which is ordinary git and is what ADR 0004 means by
 * "the unit of approval is the change, not the document".
 */
export const WorkspaceChangedDocumentSchema =
  WorkspaceDocumentEntrySchema.extend({
    /** The version this document reaches if the change is published. */
    nextVersion: z.number(),
    /** The version on record now, or null for a document being added. */
    currentVersion: DocumentVersionSchema.nullable(),
  });
export type WorkspaceChangedDocument = z.infer<
  typeof WorkspaceChangedDocumentSchema
>;

/**
 * One change in a binder, as its page reads it.
 *
 * A change is the unit of approval, so this is a question about the change
 * rather than about any one document — which is why it names the documents it
 * touches rather than sitting under one of them.
 */
export const WorkspaceChangeDetailPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  change: PullRequestWithApprovalStateSchema,
  /** Every document this change would version, in path order. */
  documents: z.array(WorkspaceChangedDocumentSchema),
  /**
   * Whether `main` has moved on since this change branched off it.
   *
   * A binder protects `main` with `block_on_outdated_branch`, so a change that
   * is behind cannot be merged however many approvals it has — which is
   * correct (approvals should be against the content that lands) but is a dead
   * end unless the page says so and offers the way out.
   *
   * Read from the pull request Gitea already returned: its merge base is the
   * base branch's head exactly when the change is up to date.
   */
  isBehind: z.boolean(),
  /**
   * Whether publishing is held while a discussion thread is open.
   *
   * Gitea has no equivalent, so the BFF enforces it at publish time — the page
   * shows it so the refusal is not a surprise.
   */
  blockOnUnresolvedThreads: z.boolean(),
  /** Open threads on this change right now. */
  unresolvedThreadCount: z.number(),
});
export type WorkspaceChangeDetailPayload = z.infer<
  typeof WorkspaceChangeDetailPayloadSchema
>;

/**
 * What publishing a change wrote.
 *
 * One tag per document the change touched, all pointing at the same merge
 * commit — several tags on one commit is ordinary git, and it is what makes
 * "who approved v4 of infection control" answerable as tag → commit → pull
 * request → reviews.
 */
export const PublishedWorkspaceChangePayloadSchema = z.object({
  ok: z.boolean(),
  tags: z.array(DocumentVersionSchema),
});
export type PublishedWorkspaceChangePayload = z.infer<
  typeof PublishedWorkspaceChangePayloadSchema
>;

/**
 * The binder as its own page reads it: what it is called, what it is for, and
 * how much is in it.
 *
 * The header of a repository page, in GitHub's terms — the two counts are what
 * the tab bar puts beside "Documents" and "Change requests", so they belong
 * here rather than in each tab's own payload. Neither tab can be trusted for
 * them: a person on Documents still needs to see that three changes are
 * waiting.
 */
export const WorkspaceOverviewPayloadSchema = z.object({
  workspace: WorkspaceSummarySchema,
  documentCount: z.number(),
  openChangeCount: z.number(),
});
export type WorkspaceOverviewPayload = z.infer<
  typeof WorkspaceOverviewPayloadSchema
>;

/** Where a change stands, or how it ended. */
export const WorkspaceChangeOutcomeSchema = z.enum([
  "open",
  "published",
  "declined",
  "withdrawn",
]);
export type WorkspaceChangeOutcome = z.infer<
  typeof WorkspaceChangeOutcomeSchema
>;

/**
 * A change as the binder's list shows it.
 *
 * One shape for open and closed alike, because the list shows them in one
 * place and a row reads the same either way — `outcome: "open"` is just the
 * outcome it has not reached yet. Two shapes meant two mappings into the same
 * UI record, which is how `isRejected` came to be missing from one of them.
 */
export const WorkspaceChangeSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  /** The branch the submitted file lives on. Empty once Gitea prunes it. */
  branchName: z.string(),
  submittedBy: z.string(),
  submittedAt: z.string(),
  /** Null while it is open. */
  closedAt: z.string().nullable(),
  outcome: WorkspaceChangeOutcomeSchema,
  /** Who published it, or who asked for work it never came back from. */
  decidedBy: z.string().nullable(),
  approvalState: z.string(),
  approvalCount: z.number(),
  /** Null means the policy could not be read; 0 means none are required. */
  requiredApprovals: z.number().nullable(),
  isApproved: z.boolean(),
  isRejected: z.boolean(),
  reviews: z.array(VersionReviewSchema),
  reviewers: z.array(ChangeReviewerSchema),
  assignee: ChangeUserSchema.nullable(),
  /**
   * The documents this change is about.
   *
   * From the upload branch while it is open, and from the version tags on its
   * merge commit once it is published — so neither costs a call per change.
   * Empty for a change made outside Bindersnap, which the row simply does not
   * describe rather than guessing at.
   */
  documents: z.array(
    z.object({
      slugPath: z.string(),
      name: z.string(),
      /** The version it published, or null while it is open. */
      version: z.number().nullable(),
    }),
  ),
});
export type WorkspaceChangeSummary = z.infer<
  typeof WorkspaceChangeSummarySchema
>;

export const WorkspaceChangeListPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  state: z.enum(["open", "closed"]),
  changes: z.array(WorkspaceChangeSummarySchema),
});
export type WorkspaceChangeListPayload = z.infer<
  typeof WorkspaceChangeListPayloadSchema
>;
