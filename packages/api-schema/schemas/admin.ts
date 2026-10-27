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

// What each of a person's organizations pays, so free access is given from
// the People list. Billing stays the organization's (ADR 0004).
export const AdminUserOrganizationSchema = z.object({
  id: z.number(),
  name: z.string(),
  billing: AdminBillingStateSchema,
});
export type AdminUserOrganization = z.infer<typeof AdminUserOrganizationSchema>;

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
  organizations: z.array(AdminUserOrganizationSchema),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUserListPayloadSchema = z.object({
  users: z.array(AdminUserRowSchema),
  query: z.string(),
  ...AdminPageFields,
});
export type AdminUserListPayload = z.infer<typeof AdminUserListPayloadSchema>;

export const SetAdminOrganizationAccessBodySchema = z.object({
  access: z.enum(["grant", "revoke"]),
  reason: z.string().optional(),
  // Free access's limits, each optional: for how many days, and for how many
  // writers. Past either, the organization is back on what it pays.
  days: z.number().int().min(1).max(3650).nullable().optional(),
  maxWriters: z.number().int().min(1).max(10_000).nullable().optional(),
});
export type SetAdminOrganizationAccessBody = z.infer<
  typeof SetAdminOrganizationAccessBodySchema
>;

export const AdminOrganizationAccessResultSchema = z.object({
  organization: z.string(),
  billing: AdminBillingStateSchema,
});
export type AdminOrganizationAccessResult = z.infer<
  typeof AdminOrganizationAccessResultSchema
>;

export const AdminFreeAccessSchema = z.object({
  expiresAt: z.number().nullable(),
  maxWriters: z.number().nullable(),
  reason: z.string().nullable(),
  grantedBy: z.string(),
  grantedAt: z.number(),
  // Why it no longer counts: it ended, or the organization has more writers
  // than it covers. Null while it counts.
  lapse: z.enum(["expired", "over_writers"]).nullable(),
});
export type AdminFreeAccess = z.infer<typeof AdminFreeAccessSchema>;

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
  freeAccess: AdminFreeAccessSchema.nullable(),
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

// ─── Signups ─────────────────────────────────────────────────────────────

/** Signups that share one value of a source, and how far they went. */
export const AdminSignupTallySchema = z.object({
  /** The page, site or campaign; null where the signup did not say. */
  key: z.string().nullable(),
  signups: z.number(),
  /** Of those, how many created an organization. */
  organizations: z.number(),
  /** Of those, how many created one that pays now. */
  paying: z.number(),
});
export type AdminSignupTally = z.infer<typeof AdminSignupTallySchema>;

export const AdminSignupRowSchema = z.object({
  username: z.string(),
  createdAt: z.number(),
  invited: z.boolean(),
  entryPath: z.string().nullable(),
  fromPath: z.string().nullable(),
  referrerHost: z.string().nullable(),
  campaign: z.string().nullable(),
  organizations: z.array(
    z.object({ name: z.string(), billing: AdminBillingStateSchema }),
  ),
});
export type AdminSignupRow = z.infer<typeof AdminSignupRowSchema>;

export const AdminSignupsPayloadSchema = z.object({
  /** Signups with a row; accounts made before rows were kept have none. */
  recorded: z.number(),
  /** Epoch ms of the first row, or null for none. */
  since: z.number().nullable(),
  byEntryPage: z.array(AdminSignupTallySchema),
  bySite: z.array(AdminSignupTallySchema),
  byCampaign: z.array(AdminSignupTallySchema),
  /** The newest signups, newest first. */
  recent: z.array(AdminSignupRowSchema),
});
export type AdminSignupsPayload = z.infer<typeof AdminSignupsPayloadSchema>;

// ─── System, configuration and accounts ──────────────────────────────────

export const AdminReleaseImageSchema = z.object({
  service: z.string(),
  name: z.string(),
  tag: z.string().nullable(),
  digest: z.string().nullable(),
});
export type AdminReleaseImage = z.infer<typeof AdminReleaseImageSchema>;

export const AdminSystemPayloadSchema = z.object({
  bindersnap: z.object({
    version: z.string().nullable(),
    commit: z.string().nullable(),
    environment: z.string(),
  }),
  gitea: z.object({ version: z.string().nullable(), url: z.string() }),
  // Null when the image does not carry the production Compose file.
  images: z.array(AdminReleaseImageSchema).nullable(),
  runtime: z.object({
    bunVersion: z.string(),
    bunRevision: z.string(),
    platform: z.string(),
    arch: z.string(),
    hostname: z.string(),
    pid: z.number(),
    startedAt: z.number(),
    cpuCount: z.number(),
    loadAverage: z.array(z.number()),
    cpuUserSeconds: z.number(),
    cpuSystemSeconds: z.number(),
    memory: z.object({
      rss: z.number(),
      heapUsed: z.number(),
      heapTotal: z.number(),
      external: z.number(),
      arrayBuffers: z.number(),
      hostTotal: z.number(),
      hostFree: z.number(),
    }),
  }),
  storage: z.object({
    databasePath: z.string(),
    databaseBytes: z.number().nullable(),
    walBytes: z.number().nullable(),
    diskTotalBytes: z.number().nullable(),
    diskFreeBytes: z.number().nullable(),
  }),
});
export type AdminSystemPayload = z.infer<typeof AdminSystemPayloadSchema>;

export const AdminConfigEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  // Never present for a secret.
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
    .nullable()
    .optional(),
  secret: z.boolean(),
  isSet: z.boolean(),
});
export type AdminConfigEntry = z.infer<typeof AdminConfigEntrySchema>;

export const AdminConfigPayloadSchema = z.object({
  sections: z.array(
    z.object({ title: z.string(), entries: z.array(AdminConfigEntrySchema) }),
  ),
});
export type AdminConfigPayload = z.infer<typeof AdminConfigPayloadSchema>;

export const AdminCreateUserBodySchema = z.object({
  username: z.string().optional(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  // Empty or absent: email them a link to choose their own.
  password: z.string().optional(),
});
export type AdminCreateUserBody = z.infer<typeof AdminCreateUserBodySchema>;

export const AdminCreatedUserSchema = z.object({
  username: z.string(),
  email: z.string(),
  fullName: z.string(),
  emailed: z.enum(["welcome", "confirmation"]),
});
export type AdminCreatedUser = z.infer<typeof AdminCreatedUserSchema>;

export const AdminReconcilerRunSchema = z.object({
  report: z
    .object({
      checkedAt: z.string(),
      binders: z.number(),
      findings: z.array(z.unknown()),
      errors: z.array(
        z.object({ org: z.string(), binder: z.string(), error: z.string() }),
      ),
    })
    .nullable(),
});
export type AdminReconcilerRun = z.infer<typeof AdminReconcilerRunSchema>;

/** A pass of the activity dataset (`services/api/activity.ts`). */
export const AdminActivityBuildSchema = z.object({
  startedAt: z.number(),
  finishedAt: z.number(),
  events: z.number(),
  binders: z.number(),
  errors: z.array(
    z.object({
      org: z.string(),
      binder: z.string().nullable(),
      error: z.string(),
    }),
  ),
});
export type AdminActivityBuild = z.infer<typeof AdminActivityBuildSchema>;

export const AdminActivityRunSchema = z.object({
  build: AdminActivityBuildSchema.nullable(),
});
export type AdminActivityRun = z.infer<typeof AdminActivityRunSchema>;
