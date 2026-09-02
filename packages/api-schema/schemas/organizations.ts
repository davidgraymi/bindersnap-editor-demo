import { z } from "zod";

/**
 * ADR 0004's first level, as the app sees it.
 *
 * An organization owns every workspace and is who we bill. `name` is the Gitea
 * org username — a URL segment — and `displayName` is what its owner called
 * it. They differ because "Mercy Health" has to become `mercy-health` to be a
 * name Gitea will accept, and only one of the two belongs in a heading.
 */
export const OrganizationSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string(),
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const OrganizationListPayloadSchema = z.object({
  organizations: z.array(OrganizationSummarySchema),
});
export type OrganizationListPayload = z.infer<
  typeof OrganizationListPayloadSchema
>;

export const NewOrganizationBodySchema = z.object({
  /** What to call it. Slugified server-side into the Gitea org username. */
  name: z.string().min(1),
});
export type NewOrganizationBody = z.infer<typeof NewOrganizationBodySchema>;

export const CreatedOrganizationPayloadSchema = z.object({
  organization: OrganizationSummarySchema.extend({
    /** The first binder, created with the organization. */
    workspace: z.string(),
    /** Unix seconds, or null when this organization gets no trial. */
    trialEndsAt: z.number().nullable(),
  }),
});
export type CreatedOrganizationPayload = z.infer<
  typeof CreatedOrganizationPayloadSchema
>;
