import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/*
 * Column names use snake_case to match the existing database.
 * TS field names are camelCase via Drizzle's column name aliases.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    giteaToken: text("gitea_token").notNull(),
    giteaTokenName: text("gitea_token_name").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [index("idx_sessions_expires").on(table.expiresAt)],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    username: text("username").primaryKey(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: integer("current_period_end", { mode: "number" }),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("idx_subscriptions_customer").on(table.stripeCustomerId)],
);
