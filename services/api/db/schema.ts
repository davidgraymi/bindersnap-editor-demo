import {
  pgTable,
  text,
  bigint,
  boolean,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";

// Single source of truth for the API service's Postgres schema.
// Mirrors the SQLite shapes in services/api/sessions.ts and subscriptions.ts.
//
// Numeric "*_at" columns are Unix milliseconds (sessions) or Unix seconds
// (Stripe webhook + subscription timestamps), preserved verbatim from the
// SQLite columns so the migration script is a straight value copy.

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    giteaToken: text("gitea_token").notNull(),
    giteaTokenName: text("gitea_token_name").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    expiresIdx: index("idx_sessions_expires").on(table.expiresAt),
  }),
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    username: text("username").primaryKey(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: bigint("current_period_end", { mode: "number" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelAt: bigint("cancel_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => ({
    customerIdx: uniqueIndex("idx_subscriptions_customer").on(
      table.stripeCustomerId,
    ),
  }),
);

export const subscriptionAccessOverrides = pgTable(
  "subscription_access_overrides",
  {
    username: text("username").primaryKey(),
    access: text("access", { enum: ["grant", "revoke"] }).notNull(),
    reason: text("reason"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
);

export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  customerId: text("customer_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  processedAt: bigint("processed_at", { mode: "number" }).notNull(),
});

export const webhookCustomerState = pgTable("webhook_customer_state", {
  customerId: text("customer_id").primaryKey(),
  lastEventCreatedAt: bigint("last_event_created_at", {
    mode: "number",
  }).notNull(),
});

// Tracks the schema version the database has been migrated to. The migration
// runner inserts/updates this row after each migration applies cleanly. The
// API queries it at startup and refuses to run on a mismatch.
//
// `id = 1` is enforced so this is a singleton row; we never store history here.
export const schemaVersions = pgTable("schema_versions", {
  id: integer("id").primaryKey(),
  version: text("version").notNull(),
  appliedAt: bigint("applied_at", { mode: "number" }).notNull(),
});
