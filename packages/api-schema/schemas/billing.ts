import { z } from "zod";

export const AdminSubscriptionAccessSourceSchema = z.enum([
  "config_bypass",
  "stripe",
  "admin_grant",
  "admin_revoke",
  "none",
]);
export type AdminSubscriptionAccessSource = z.infer<
  typeof AdminSubscriptionAccessSourceSchema
>;

export const AdminSubscriptionAccessOverrideSchema = z.object({
  username: z.string(),
  access: z.enum(["grant", "revoke"]),
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

export const BillingStatusPayloadSchema = z.object({
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
