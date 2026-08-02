import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Canonical schema for the API's SQLite database (one file on the EBS data
// volume, BINDERSNAP_SESSIONS_DB_PATH). drizzle-kit generates migrations from
// this file (`bun run db:generate`); the stores apply them on open via
// db/client.ts.
//
// Two deliberate deviations between this schema and the generated SQL:
//   - The 0000 baseline is hand-edited to use IF NOT EXISTS DDL so it
//     no-ops against a production database that predates drizzle (the
//     tables were originally created inline by the stores).
//   - The unique index on subscriptions.stripe_customer_id is NOT part of
//     any migration. SubscriptionStore.enforceUniqueCustomerBindings()
//     creates it after deduplicating legacy rows — a unique index in the
//     baseline would fail on a legacy database that still holds duplicates.

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    giteaToken: text("gitea_token").notNull(),
    giteaTokenName: text("gitea_token_name").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("idx_sessions_expires").on(table.expiresAt)],
);

export const subscriptions = sqliteTable("subscriptions", {
  username: text("username").primaryKey(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: integer("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
    .notNull()
    .default(false),
  cancelAt: integer("cancel_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const subscriptionAccessOverrides = sqliteTable(
  "subscription_access_overrides",
  {
    username: text("username").primaryKey(),
    access: text("access", { enum: ["grant", "revoke"] }).notNull(),
    reason: text("reason"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const processedWebhookEvents = sqliteTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  customerId: text("customer_id"),
  createdAt: integer("created_at").notNull(),
  processedAt: integer("processed_at").notNull(),
});

export const webhookCustomerState = sqliteTable("webhook_customer_state", {
  customerId: text("customer_id").primaryKey(),
  lastEventCreatedAt: integer("last_event_created_at").notNull(),
});
