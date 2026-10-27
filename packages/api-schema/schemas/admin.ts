import { z } from "zod";
import {
  AdminSubscriptionAccessOverrideSchema,
  AdminSubscriptionAccessSourceSchema,
  BillingOrganizationSchema,
} from "./billing";

export const AdminSubscriptionAccessUserSchema = z.object({
  username: z.string(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  // The console is addressed by person, but everything it reports and changes
  // belongs to that person's organization.
  organization: BillingOrganizationSchema.nullable(),
  trialEndsAt: z.number().nullable().optional(),
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

// ─── The admin console (#840) ────────────────────────────────────────────

const AdminPageFields = {
  page: z.number(),
  limit: z.number(),
  total: z.number().nullable(),
  hasMore: z.boolean(),
};

export const AdminHealthCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "warn", "down"]),
  detail: z.string(),
});
export type AdminHealthCheck = z.infer<typeof AdminHealthCheckSchema>;

export const AdminBillingTallySchema = z.object({
  paying: z.number(),
  pastDue: z.number(),
  trial: z.number(),
  trialEnded: z.number(),
  comped: z.number(),
  revoked: z.number(),
  canceled: z.number(),
  none: z.number(),
});

export const AdminOverviewPayloadSchema = z.object({
  checkedAt: z.number(),
  checks: z.array(AdminHealthCheckSchema),
  counts: z.object({
    users: z.number().nullable(),
    organizations: z.number().nullable(),
    binders: z.number().nullable(),
    unconfirmedEmails: z.number().nullable(),
  }),
  billing: AdminBillingTallySchema,
});
export type AdminOverviewPayload = z.infer<typeof AdminOverviewPayloadSchema>;

export const AdminUserRowSchema = z.object({
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  // `predates`: the account was made before addresses had to be confirmed.
  emailConfirmation: z.enum(["confirmed", "waiting", "predates"]),
  emailConfirmedAt: z.number().nullable(),
  isSiteAdmin: z.boolean(),
  active: z.boolean(),
  prohibitLogin: z.boolean(),
  createdAt: z.number().nullable(),
  lastLoginAt: z.number().nullable(),
  liveSessions: z.number(),
  organizations: z.array(z.string()),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUserListPayloadSchema = z.object({
  users: z.array(AdminUserRowSchema),
  query: z.string(),
  ...AdminPageFields,
});
export type AdminUserListPayload = z.infer<typeof AdminUserListPayloadSchema>;

export const AdminBillingStateSchema = z.enum([
  "paying",
  "past_due",
  "trial",
  "trial_ended",
  "comped",
  "revoked",
  "canceled",
  "none",
]);
export type AdminBillingState = z.infer<typeof AdminBillingStateSchema>;

export const AdminOrganizationRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  fullName: z.string(),
  email: z.string(),
  known: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.number().nullable(),
  owners: z.array(z.string()),
  seats: z.number().nullable(),
  binders: z.number().nullable(),
  hasAccess: z.boolean(),
  billing: AdminBillingStateSchema,
  stripeStatus: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  currentPeriodEnd: z.number().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialEndsAt: z.number().nullable(),
});
export type AdminOrganizationRow = z.infer<typeof AdminOrganizationRowSchema>;

export const AdminOrganizationListPayloadSchema = z.object({
  organizations: z.array(AdminOrganizationRowSchema),
  ...AdminPageFields,
});
export type AdminOrganizationListPayload = z.infer<
  typeof AdminOrganizationListPayloadSchema
>;

export const AdminBinderRowSchema = z.object({
  id: z.number(),
  org: z.string(),
  name: z.string(),
  description: z.string(),
  private: z.boolean(),
  archived: z.boolean(),
  empty: z.boolean(),
  sizeKb: z.number(),
  openChanges: z.number(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
});
export type AdminBinderRow = z.infer<typeof AdminBinderRowSchema>;

export const AdminBinderListPayloadSchema = z.object({
  binders: z.array(AdminBinderRowSchema),
  query: z.string(),
  ...AdminPageFields,
});
export type AdminBinderListPayload = z.infer<
  typeof AdminBinderListPayloadSchema
>;
