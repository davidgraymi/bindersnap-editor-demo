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
  /**
   * Whether the whole organization can read it. **Asked at creation, and
   * preselected to open.**
   *
   * The moment somebody is naming a binder is the moment they know whether it
   * is the staff handbook or HR investigations, and it is far cheaper to ask
   * then than to discover the wrong answer a week later. Open is the default
   * because the common case is a policy manual everybody must be able to read
   * in order to attest to it — a default, not an assumption.
   *
   * Absent means open, so a client that does not ask gets the answer the
   * product would have given anyway.
   */
  openToOrganization: z.boolean().optional(),
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
  /**
   * When the commit this tag points at was made — when the change that
   * published it was merged. Empty when Gitea did not say, which a reader is
   * told rather than shown a date we invented.
   */
  publishedAt: z.string(),
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
    /**
     * Every published version, newest first.
     *
     * The comparison needs the one *below* the version a published change
     * became — reading a published change against today's record would be
     * comparing it with itself.
     */
    versions: z.array(DocumentVersionSchema),
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
  /**
   * Whether this caller may write in the binder — which is what decides
   * whether they are offered the reviewer list to edit.
   *
   * Gitea's own check still refuses the act; this only keeps the buttons
   * honest.
   */
  canManage: z.boolean(),
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

/**
 * One published version, as the binder's history reads it.
 *
 * ADR 0004: "who approved v4 of infection control is answered by tag → commit
 * → pull request → reviews. The record is exact." This is that chain walked
 * once for the whole binder and put on a page — the tags name the versions,
 * and the merge commit each one points at names the change that published it
 * and everyone who signed it off.
 */
export const WorkspaceHistoryEntrySchema = z.object({
  /** `clinical/infection-control` — the document's identity. */
  slugPath: z.string(),
  name: z.string(),
  /** `clinical`, or "" at the binder's root. */
  folder: z.string(),
  version: z.number(),
  tag: z.string(),
  commitSha: z.string(),
  /** When the change was merged. Empty when Gitea did not say. */
  publishedAt: z.string(),
  /**
   * The change that published it, or null for a tag written outside the app.
   *
   * Null is not a fault: a binder is a git repository and somebody may tag it
   * themselves. The row simply cannot lead anywhere.
   */
  changeNumber: z.number().nullable(),
  changeTitle: z.string(),
  submittedBy: z.string(),
  /** Everyone whose approval stood when it was published. */
  approvers: z.array(z.string()),
});
export type WorkspaceHistoryEntry = z.infer<typeof WorkspaceHistoryEntrySchema>;

export const WorkspaceHistoryPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  /** Newest first. */
  versions: z.array(WorkspaceHistoryEntrySchema),
});
export type WorkspaceHistoryPayload = z.infer<
  typeof WorkspaceHistoryPayloadSchema
>;

/** One person who can act in a binder, through a team granted onto it. */
export const WorkspacePersonSchema = z.object({
  login: z.string(),
  fullName: z.string(),
});
export type WorkspacePerson = z.infer<typeof WorkspacePersonSchema>;

/**
 * A team granted onto the binder, and who is in it.
 *
 * `access` is the effective permission on `repo.code`, which is what ADR 0004
 * counts as a paid seat — write or better is an author, read is a reviewer and
 * is free. Reported as Gitea has it rather than as a name we chose, because
 * the permission is the thing that is enforced.
 */
export const WorkspaceTeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  /** `admin`, `write`, `read`, or `none`. */
  access: z.string(),
  members: z.array(WorkspacePersonSchema),
});
export type WorkspaceTeam = z.infer<typeof WorkspaceTeamSchema>;

/**
 * The rules a binder is governed by.
 *
 * Branch protection is Gitea's and is enforced at the merge;
 * `blockOnUnresolvedThreads` has no Gitea equivalent and is enforced by the
 * BFF at publish. Shown together because a customer does not care which of us
 * enforces what — they care what has to be true before a policy changes.
 */
export const WorkspaceRulesSchema = z.object({
  /** Null when the rule could not be read at all. */
  requiredApprovals: z.number().nullable(),
  /** A new version clears the approvals the last one collected. */
  dismissStaleApprovals: z.boolean(),
  /** Nothing but an approved change reaches the record. */
  pushBlocked: z.boolean(),
  blockOnUnresolvedThreads: z.boolean(),
});
export type WorkspaceRules = z.infer<typeof WorkspaceRulesSchema>;

export const WorkspaceSettingsPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  teams: z.array(WorkspaceTeamSchema),
  rules: WorkspaceRulesSchema,
  /** Whether this caller may change any of it. */
  canManage: z.boolean(),
});
export type WorkspaceSettingsPayload = z.infer<
  typeof WorkspaceSettingsPayloadSchema
>;

/**
 * One person in the organization.
 *
 * Two rungs, and only two: owner and member. Every third org-level role anyone
 * proposes turns out to be a binder role wearing a costume — "compliance lead"
 * is a manager of the binders they run, "auditor" is a reviewer on everything —
 * and a rung above the binder is the expensive kind, because Gitea will not
 * enforce a distinction we invent.
 */
export const OrganizationPersonSchema = z.object({
  login: z.string(),
  fullName: z.string(),
  isOwner: z.boolean(),
  /** The groups they are in, which is where their binder access comes from. */
  teams: z.array(z.string()),
});
export type OrganizationPerson = z.infer<typeof OrganizationPersonSchema>;

/**
 * A group the organization has, and what it grants wherever it is adopted.
 *
 * A Gitea team carries one unit map, so a group's level is a property of the
 * group rather than of the grant: "Quality Committee" cannot be an editor in
 * one binder and a reviewer in another. That is why a group is named and
 * levelled together, and why the level travels with the name everywhere it
 * appears.
 */
export const OrganizationGroupSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  /** `owner`, `admin`, `write`, `read` or `none` on `repo.code`. */
  access: z.string(),
  memberCount: z.number(),
  /**
   * Who is in it. Carried on the group rather than fetched per group when
   * somebody opens one: the handler has already read every team's membership
   * to answer "which groups is this person in", so sending it costs nothing and
   * saves a call per group the moment anybody manages one.
   */
  members: z.array(WorkspacePersonSchema),
  /**
   * The binders this group reaches, which is the question an owner has while
   * they are looking at the group rather than at a binder — and the one that
   * decides whether changing it is safe, because a level or membership change
   * lands on every binder in this list at once.
   *
   * For the built-in Owners team this is every binder in the organization, and
   * always will be: Gitea gives it admin org-wide rather than by a grant.
   */
  binders: z.array(z.string()),
});
export type OrganizationGroup = z.infer<typeof OrganizationGroupSchema>;

/** Naming a group and levelling it, which is one act. */
export const CreateOrganizationGroupRequestSchema = z.object({
  /** What the customer typed. Slugified into the handle Gitea stores. */
  name: z.string(),
  /** `admin`, `editor` or `reviewer`. Fixed at creation — see the group. */
  level: z.string(),
});
export type CreateOrganizationGroupRequest = z.infer<
  typeof CreateOrganizationGroupRequestSchema
>;

export const CreatedOrganizationGroupPayloadSchema = z.object({
  organization: z.string(),
  group: OrganizationGroupSchema,
});
export type CreatedOrganizationGroupPayload = z.infer<
  typeof CreatedOrganizationGroupPayloadSchema
>;

/**
 * Promoting somebody to owner, or demoting them back to member.
 *
 * Two rungs and only two. An owner is a member of Gitea's built-in `Owners`
 * team, so this is one team membership either way and nothing is stored —
 * billing keeps reading the same team it always did.
 */
export const OrganizationPersonRoleRequestSchema = z.object({
  owner: z.boolean(),
});
export type OrganizationPersonRoleRequest = z.infer<
  typeof OrganizationPersonRoleRequestSchema
>;

export const OrganizationGroupMemberRequestSchema = z.object({
  username: z.string(),
});
export type OrganizationGroupMemberRequest = z.infer<
  typeof OrganizationGroupMemberRequestSchema
>;

/**
 * Composing a group onto a binder, and what that did to the approvals
 * whitelist.
 *
 * The whitelist comes back because it is the half of the act that fails
 * silently: `enable_approvals_whitelist` is what makes a free reviewer's
 * approval count, and a team missing from the list has its members' approvals
 * recorded, displayed, and satisfying nothing. Returning it makes the recompute
 * assertable rather than assumed.
 */
export const BinderGroupRequestSchema = z.object({
  /** The group's handle, as Gitea holds it. */
  group: z.string(),
});
export type BinderGroupRequest = z.infer<typeof BinderGroupRequestSchema>;

/**
 * One person in a binder, and where their access comes from.
 *
 * **One row per person, not a matrix and not a list per role.** The roles are a
 * ladder Gitea enforces as one, so a grid of checkboxes would let somebody try
 * "can approve but cannot read", which is not a thing and the screen would have
 * to refuse. And grouping by role answers "who are the editors" when the
 * question a compliance manager actually asks is "what can Jane do" — which one
 * row answers by being read.
 *
 * `through` is the whole reason this is not a simple list. A person here
 * because they are in a shared group cannot have their role changed on this
 * binder, because the group is one object across every binder it reaches. The
 * row names the group instead of offering a control that would have to refuse
 * — and the consolation is that "why can Aisha approve here" is answered on the
 * row that raised the question.
 */
export const BinderPersonSchema = z.object({
  login: z.string(),
  fullName: z.string(),
  /** Effective access on `repo.code`: `owner`, `admin`, `write` or `read`. */
  access: z.string(),
  /** The team that grants it — the highest-ranking one they are in here. */
  through: z.string(),
  /**
   * Whether that team is this binder's own role team, and therefore whether
   * their role here can be changed without changing another binder.
   */
  individual: z.boolean(),
  /**
   * The **groups** granted here that they are in — this binder's own role teams
   * are left out, because naming them would tell the reader that "Priya is in
   * clinical-authors", which is our bookkeeping rather than an answer to
   * anything they asked. What is left is the part that explains the row and
   * reaches other binders.
   */
  groups: z.array(z.string()),
  /** Write or better on `repo.code`, which is what ADR 0004 bills for. */
  seat: z.boolean(),
});
export type BinderPerson = z.infer<typeof BinderPersonSchema>;

export const BinderPeoplePayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  people: z.array(BinderPersonSchema),
  /** The teams granted here — the groups half of the same question. */
  groups: z.array(WorkspaceTeamSchema),
  /**
   * Whether the whole organization can read this binder, derived by asking
   * whether `staff` is granted. Nothing is stored: a copy could disagree with
   * the grant Gitea is the one enforcing.
   */
  openToOrganization: z.boolean(),
  /** Everyone in the organization, so somebody can be added from a picker. */
  organizationMembers: z.array(WorkspacePersonSchema),
  /** Whether this caller may change any of it. */
  canManage: z.boolean(),
});
export type BinderPeoplePayload = z.infer<typeof BinderPeoplePayloadSchema>;

/**
 * Who can see this binder — one switch over one primitive.
 *
 * `staff` granted onto the repository, or not. Nothing is stored: the answer is
 * derived by asking Gitea which teams are granted here, because a stored copy
 * could disagree with the grant Gitea is the one enforcing.
 */
export const BinderVisibilityRequestSchema = z.object({
  openToOrganization: z.boolean(),
});
export type BinderVisibilityRequest = z.infer<
  typeof BinderVisibilityRequestSchema
>;

/** Adding somebody to this binder, or moving them between its roles. */
export const BinderPersonRequestSchema = z.object({
  username: z.string(),
  /** `admin`, `editor` or `reviewer` — the same three levels a group has. */
  level: z.string(),
});
export type BinderPersonRequest = z.infer<typeof BinderPersonRequestSchema>;

export const BinderGroupsPayloadSchema = z.object({
  organization: z.string(),
  workspace: z.string(),
  /** Every team granted onto this binder, after the change. */
  teams: z.array(WorkspaceTeamSchema),
  /** Every team whose members' approvals now count. */
  approvalsWhitelist: z.array(z.string()),
});
export type BinderGroupsPayload = z.infer<typeof BinderGroupsPayloadSchema>;

export const OrganizationPeoplePayloadSchema = z.object({
  organization: z.string(),
  people: z.array(OrganizationPersonSchema),
  groups: z.array(OrganizationGroupSchema),
  /**
   * Every binder in the organization, so a group can be composed onto one from
   * the group's own row. The names alone: this list exists to fill a picker,
   * and the binder's own page is where anything else about it is answered.
   */
  binders: z.array(z.string()),
  /** Whether the caller owns the organization, and may change any of it. */
  canManage: z.boolean(),
  /**
   * Who is asking. Their own row offers no "remove", because leaving an
   * organization is a different act from removing somebody else and deserves
   * its own wording rather than a menu item that reads like an accident.
   */
  viewer: z.string(),
});
export type OrganizationPeoplePayload = z.infer<
  typeof OrganizationPeoplePayloadSchema
>;
