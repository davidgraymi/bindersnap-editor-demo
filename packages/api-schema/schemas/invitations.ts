import { z } from "zod";

/** Invitations into an organization by email (issue #426). */

export const InvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "joined",
  "revoked",
  "expired",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const BinderLevelSchema = z.enum(["admin", "editor", "reviewer"]);
export type BinderLevel = z.infer<typeof BinderLevelSchema>;

/** One invitation, as an owner's pending list shows it. */
export const InvitationRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  orgRole: z.enum(["owner", "member"]),
  binder: z.string().nullable(),
  binderLevel: BinderLevelSchema.nullable(),
  /** "a reviewer in Clinical Policies" — what accepting gives. */
  grant: z.string(),
  invitedBy: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: InvitationStatusSchema,
});
export type InvitationRow = z.infer<typeof InvitationRowSchema>;

export const InvitationListPayloadSchema = z.object({
  invitations: z.array(InvitationRowSchema),
});
export type InvitationListPayload = z.infer<typeof InvitationListPayloadSchema>;

export const InvitationPayloadSchema = z.object({
  invitation: InvitationRowSchema,
});
export type InvitationPayload = z.infer<typeof InvitationPayloadSchema>;

export const CreateInvitationBodySchema = z.object({
  email: z.string().min(1),
  /** An owner, rather than a member. */
  owner: z.boolean().optional(),
  /** A binder to land them in, and at which level. */
  binder: z.string().optional(),
  level: BinderLevelSchema.optional(),
});
export type CreateInvitationBody = z.infer<typeof CreateInvitationBodySchema>;

/** What an invitation link is for, for its page. The address is masked. */
export const InvitationSummarySchema = z.object({
  organization: z.string(),
  organizationName: z.string(),
  invitedBy: z.string(),
  grant: z.string(),
  email: z.string(),
  status: InvitationStatusSchema,
  acceptedByYou: z.boolean().optional(),
});
export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;

export const AcceptInvitationResultSchema = z.object({
  /** `joined` — in; `accepted` — waiting for an owner to be signed in. */
  status: InvitationStatusSchema,
});
export type AcceptInvitationResult = z.infer<
  typeof AcceptInvitationResultSchema
>;
