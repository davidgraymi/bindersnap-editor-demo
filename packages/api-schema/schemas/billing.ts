import { z } from "zod";

export const AdminSubscriptionAccessSourceSchema = z.enum([
  "config_bypass",
  "stripe",
  // ADR 0004: a 14-day local trial, not a Stripe `trialing` subscription —
  // #369 wants no card at all during it.
  "trial",
  "admin_grant",
  "admin_revoke",
  // The account is in no organization, so there is nothing to bill.
  "no_organization",
  "none",
]);
export type AdminSubscriptionAccessSource = z.infer<
  typeof AdminSubscriptionAccessSourceSchema
>;

export const AdminSubscriptionAccessOverrideSchema = z.object({
  access: z.enum(["grant", "revoke"]),
  mode: z.enum(["grant", "revoke"]).optional(),
  reason: z.string().nullable().optional(),
  updatedBy: z.string(),
  updatedAt: z.number(),
});
export type AdminSubscriptionAccessOverride = z.infer<
  typeof AdminSubscriptionAccessOverrideSchema
>;

export const BillingPlanSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  interval: z.string(),
  formatted: z.string(),
});

/** Who we bill. Null for an account that is in no organization yet. */
export const BillingOrganizationSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const BillingStatusPayloadSchema = z.object({
  organization: BillingOrganizationSchema.nullable(),
  trialEndsAt: z.number().nullable(),
  status: z.string().nullable(),
  currentPeriodEnd: z.number().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancelAt: z.number().nullable(),
  hasAccess: z.boolean(),
  accessSource: AdminSubscriptionAccessSourceSchema.nullable(),
  override: AdminSubscriptionAccessOverrideSchema.nullable(),
  plan: BillingPlanSchema.nullable(),
});
export type BillingStatusPayload = z.infer<typeof BillingStatusPayloadSchema>;

export const BillingActionBodySchema = z.object({
  idempotencyKey: z.string(),
});
export type BillingActionBody = z.infer<typeof BillingActionBodySchema>;

export const BillingUrlResultSchema = z.object({
  url: z.string(),
});

/**
 * The body of a 402 from the paywall.
 *
 * Typed because a 402 is not always the paywall talking — `GET
 * /api/app/billing` answers 402 with a whole billing status when an
 * organization is delinquent, and the SPA has to be able to tell the two
 * apart. It used to tell them apart by matching the request path, which meant
 * every new billing route had to remember to be listed. `code` is the
 * distinction stated rather than inferred.
 *
 * `organization` is the org that owes us, named so the banner can say whose
 * bill it is — a person in two organizations gets no help from "your
 * subscription".
 */
export const PaymentRequiredPayloadSchema = z.object({
  error: z.string(),
  code: z.literal("subscription_required"),
  organization: z.string().nullable(),
});
export type PaymentRequiredPayload = z.infer<
  typeof PaymentRequiredPayloadSchema
>;
