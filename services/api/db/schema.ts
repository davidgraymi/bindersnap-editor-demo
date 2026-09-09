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

/**
 * The organization is a Gitea org, so everything Gitea models natively —
 * identity, membership, who owns it — is read from Gitea and never mirrored
 * here. This table holds only the facts Gitea has no primitive for: the local
 * trial window, and (once billing is re-keyed) the Stripe linkage.
 *
 * Keyed on the Gitea org id rather than the org name because Gitea renames
 * organizations (`POST /orgs/{org}/rename`) and a name key breaks silently
 * when it happens. The name is carried alongside for display only — treat it
 * as a cache of Gitea's answer, never as an identifier.
 */
export const organizations = sqliteTable(
  "organizations",
  {
    giteaOrgId: integer("gitea_org_id").primaryKey(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    /**
     * #369 wants no card during the trial, so the trial is a local column
     * rather than a Stripe `trialing` subscription — representing it in Stripe
     * would create a customer and a subscription for every tire-kicker. Unix
     * seconds, or null for an org that never had one.
     */
    trialEndsAt: integer("trial_ends_at"),
  },
  (table) => [index("idx_organizations_name").on(table.name)],
);

/**
 * We bill the organization, never a person (ADR 0004). Keyed on the Gitea org
 * id for the same reason `organizations` is: Gitea renames orgs, and the old
 * `username` key broke silently when it did — as well as tying a customer's
 * subscription to whichever human happened to sign up first.
 */
export const subscriptions = sqliteTable("subscriptions", {
  giteaOrgId: integer("gitea_org_id").primaryKey(),
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
    giteaOrgId: integer("gitea_org_id").primaryKey(),
    access: text("access", { enum: ["grant", "revoke"] }).notNull(),
    reason: text("reason"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

/**
 * The username-keyed rows as they stood before the re-key, kept verbatim.
 *
 * Mapping a username to an organization needs Gitea, which a SQL migration
 * cannot reach — so the migration parks the old rows here and
 * `scripts/backfill-org-billing.ts` maps them. Nothing in the request path
 * reads these tables. They are evidence that the re-key lost nothing, and they
 * are dropped by hand once the backfill has been verified.
 */
export const legacyUsernameSubscriptions = sqliteTable(
  "legacy_username_subscriptions",
  {
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
  },
);

export const legacyUsernameSubscriptionAccessOverrides = sqliteTable(
  "legacy_username_subscription_access_overrides",
  {
    username: text("username").primaryKey(),
    access: text("access", { enum: ["grant", "revoke"] }).notNull(),
    reason: text("reason"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

/**
 * A binder's review policy, for the one rule Gitea cannot express.
 *
 * Gitea has no equivalent of GitHub's "require conversation resolution", so
 * `blockOnUnresolvedThreads` is enforced by the BFF at publish time. It used to
 * be a committed JSON file on a `bindersnap-config` branch, and ADR 0004
 * retires that: it is configuration, not evidence, and the ADR's own section on
 * why configuration does not go in a git repo is about exactly this file.
 *
 * The argument for the file was that a commit records who changed the policy
 * and when. That is worth keeping — it is just not worth a git branch, an
 * untyped JSON blob that degrades **silently to the permissive policy** when
 * malformed, and a network round trip per read. `settings_events` below records
 * the same fact, indexed, in one query.
 *
 * **Keyed on the Gitea repository id**, for the same reason `organizations` is
 * keyed on the org id: Gitea renames repositories, and a name key breaks
 * silently when it does. The organization and binder names ride along for
 * display and are never identifiers.
 */
export const workspaceSettings = sqliteTable("workspace_settings", {
  giteaRepoId: integer("gitea_repo_id").primaryKey(),
  organization: text("organization").notNull(),
  workspace: text("workspace").notNull(),
  blockOnUnresolvedThreads: integer("block_on_unresolved_threads", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Who changed a binder's rules, when, and to what. Append-only.
 *
 * ADR 0004: "A settings *change* is still worth recording — who relaxed the
 * thread requirement, and when. That is an append-only `settings_events` table.
 * It is telemetry about administration, not evidence about a document."
 *
 * The distinction is the whole point and is worth not blurring. Evidence about
 * a *document* — what the policy was when a version was published — is stamped
 * into that version's annotated tag, where it is immutable, attached to the
 * exact event, and readable from a bare clone with no application running.
 * Losing this table costs the administrative trail and no evidence at all.
 */
export const settingsEvents = sqliteTable(
  "settings_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    giteaRepoId: integer("gitea_repo_id").notNull(),
    /** The setting's name, so a second rule can be added without a migration. */
    setting: text("setting").notNull(),
    /** Null for the first time a setting is written. */
    previousValue: text("previous_value"),
    newValue: text("new_value").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: integer("changed_at").notNull(),
  },
  (table) => [
    index("idx_settings_events_repo").on(table.giteaRepoId, table.changedAt),
  ],
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
