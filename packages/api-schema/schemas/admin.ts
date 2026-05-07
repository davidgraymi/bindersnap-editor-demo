import { z } from "zod";
import {
  AdminSubscriptionAccessOverrideSchema,
  AdminSubscriptionAccessSourceSchema,
} from "./billing";

export const AdminSubscriptionAccessUserSchema = z.object({
  username: z.string(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  hasAccess: z.boolean(),
  accessSource: AdminSubscriptionAccessSourceSchema,
  stripeStatus: z.string().nullable(),
  currentPeriodEnd: z.number().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancelAt: z.number().nullable(),
  override: AdminSubscriptionAccessOverrideSchema.nullable(),
});
export type AdminSubscriptionAccessUser = z.infer<
  typeof AdminSubscriptionAccessUserSchema
>;

export const AdminSubscriptionAccessListPayloadSchema = z.object({
  users: z.array(AdminSubscriptionAccessUserSchema),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
  query: z.string(),
});
export type AdminSubscriptionAccessListPayload = z.infer<
  typeof AdminSubscriptionAccessListPayloadSchema
>;

export const SetAdminAccessBodySchema = z.object({
  access: z.enum(["grant", "revoke"]),
});
export type SetAdminAccessBody = z.infer<typeof SetAdminAccessBodySchema>;

export const AdminAccessUserResultSchema = z.object({
  user: AdminSubscriptionAccessUserSchema,
});
