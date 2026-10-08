import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

/**
 * What a person called the draft they are working in.
 *
 * **A name, and nothing else — the draft itself is the branch.** Every act on
 * a draft is a commit on `draft/<username>/<stamp>`, and that is where the
 * work lives, permanently, in Gitea (ADR 0004). This table holds one string
 * per branch so that "resume the one from Tuesday" has an answer, which it
 * does not when a person has three drafts and all of them are called
 * `draft/alice/…`.
 *
 * **Why this is not in Gitea, given the rule that says it should be.** ADR
 * 0004's rule is "use the Gitea primitive where one exists and never shadow
 * it". There is no Gitea primitive for a label on a branch: a tag labels a
 * commit and is part of the permanent record, and minting deletable tags for
 * unproposed work would shadow the one thing tags mean here. Encoding the name
 * in the branch would mean slugging a sentence somebody typed and then
 * guessing it back.
 *
 * So it lands where the ADR puts everything that is not evidence. And it
 * genuinely is not evidence: a draft's name never reaches the record. The
 * moment the draft is proposed the name becomes the change request's title —
 * which is in Gitea, on the pull request, and then on the merge commit and the
 * version tags. Losing this table costs labels on work nobody has been asked
 * to look at, and costs no evidence at all.
 *
 * Keyed on the branch within the repository, because the branch is the draft's
 * identity and a person may have several. Rows are deleted when the draft is
 * discarded or proposed; one left behind by a branch deleted in Gitea directly
 * is harmless, because nothing reads it without the branch.
 */
export const binderDrafts = sqliteTable(
  "binder_drafts",
  {
    giteaRepoId: integer("gitea_repo_id").notNull(),
    /** `draft/alice/20260919145255` — the branch this names. */
    branch: text("branch").notNull(),
    /** What it is called. Never empty; the route refuses that. */
    name: text("name").notNull(),
    /**
     * Whether a person wrote this name, or it took the date it was started.
     *
     * **It decides whether the name is offered as the change request's
     * title.** A draft its author called "Reorganise nursing" has already said
     * what the work is for, and asking again on the way out invites a worse
     * sentence. "Draft of 19 September" has said nothing, and putting it in
     * front of reviewers as a title is exactly what the propose screen exists
     * to prevent.
     */
    authored: integer("authored", { mode: "boolean" }).notNull().default(false),
    /** Whose it is, so a stale row can be cleared out by owner. */
    owner: text("owner").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.giteaRepoId, table.branch] }),
    index("idx_binder_drafts_owner").on(table.giteaRepoId, table.owner),
  ],
);

/**
 * Work the API has promised to finish: a multi-step Gitea write recorded
 * before its first step runs. See `jobs/` and ADR 0004's note on operational
 * state.
 *
 * **Not evidence, and never read as such.** A row says what is left to do —
 * merge change 12, then tag these documents at these versions — and nothing
 * here answers "was this approved" or "what version is live"; Gitea answers
 * those. Once a job is done its row can be deleted without losing anything,
 * which is the test ADR 0004 sets for state that may live outside Gitea. The
 * Stripe `webhook_events` table is the precedent.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    /** `publish` — what the plan is for, and which runner reads it. */
    kind: text("kind").notNull(),
    /** `org/repo`. Jobs in one group run one at a time, in order. */
    groupKey: text("group_key").notNull(),
    /** What it acts on within the group — `change:12` — for finding it again. */
    subject: text("subject").notNull(),
    /** From the request's `Idempotency-Key`, so a retried click gets this job. */
    idempotencyKey: text("idempotency_key"),
    /** JSON: everything needed to finish without the request that made it. */
    plan: text("plan").notNull(),
    /** `pending`, `running`, `done` or `failed`. */
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** Epoch ms. A running job whose lease has lapsed is picked up again. */
    leaseUntil: integer("lease_until"),
    lastError: text("last_error"),
    /** JSON: what the finished job reports back. */
    result: text("result"),
    /** Who asked. The audit fields come from here, not from whoever resumes. */
    createdBy: text("created_by").notNull(),
    /** Their session, whose token a resumed run may use while it lasts. */
    sessionId: text("session_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_jobs_status").on(table.status, table.leaseUntil),
    index("idx_jobs_subject").on(table.groupKey, table.subject),
    uniqueIndex("idx_jobs_idempotency_key").on(table.idempotencyKey),
  ],
);

/**
 * Email waiting to be sent, and a short memory of what was (issue #665).
 *
 * The action that causes an email — a review requested, a reset asked for —
 * writes a row here and is done; `mail/sender.ts` delivers it in the
 * background and retries. So SES being slow or down never fails the action,
 * and a deploy mid-send loses nothing, because the row was committed first.
 *
 * Not evidence: an email is a courtesy about something already on the record
 * in Gitea. A sent row keeps who, what and when for 30 days for support, and
 * its body is blanked as it goes out — a reset or invitation link is a
 * credential, and the outbox is not where one should be kept.
 *
 * `idempotency_key` makes "send this once" a constraint, not a hope: the same
 * event queued twice (a retried request, a webhook delivered again) is one
 * email.
 */
export const emailOutbox = sqliteTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    /** Extra headers, as a JSON object — `List-Unsubscribe` and its kin. */
    headers: text("headers"),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [
    index("idx_email_outbox_due").on(table.status, table.nextAttemptAt),
    uniqueIndex("idx_email_outbox_idempotency_key").on(table.idempotencyKey),
  ],
);

/**
 * Outstanding "forgot password" links (issue #665).
 *
 * Only a SHA-256 of each token is kept, so a copy of this database cannot be
 * used to reset anybody's password. A link works once (`used_at`) and for an
 * hour (`expires_at`); asking again, or a reset going through, retires every
 * other link the person had. The password itself lives in Gitea, and the
 * reset sets it there.
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (table) => [index("idx_password_resets_username").on(table.username)],
);

/**
 * Which emails each person wants (issue #665). Settings, so SQLite (ADR 0004).
 *
 * No row means every topic on: a person who never opened the settings gets
 * what everybody gets. `unsubscribe_token` is random, per person, and is what
 * an email's unsubscribe link carries — so turning email off needs no sign-in,
 * and the link cannot be guessed for anybody else.
 */
export const emailPreferences = sqliteTable("email_preferences", {
  /** Lower-cased: Gitea logins are case-insensitive. */
  username: text("username").primaryKey(),
  reviewRequested: integer("review_requested", { mode: "boolean" })
    .notNull()
    .default(true),
  changesRequested: integer("changes_requested", { mode: "boolean" })
    .notNull()
    .default(true),
  readyToPublish: integer("ready_to_publish", { mode: "boolean" })
    .notNull()
    .default(true),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Whether an account has shown it owns its email address (issue #665).
 *
 * Signup writes a row, unconfirmed; the emailed link confirms it. An account
 * with no row predates this — the seed's, and every account made before it —
 * and counts as confirmed. Account state rather than evidence, so SQLite
 * (ADR 0004): Gitea marks every address an admin creates as activated, so its
 * own flag cannot say whether this one was.
 *
 * Only a SHA-256 of the token is stored. It is kept after use, so opening the
 * same link twice says "confirmed" rather than "this link does not work".
 */
export const emailVerifications = sqliteTable("email_verifications", {
  /** Lower-cased: Gitea logins are case-insensitive. */
  username: text("username").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  sentAt: integer("sent_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  verifiedAt: integer("verified_at"),
});

/**
 * Invitations into an organization, by email (issue #426, design in
 * docs/design/org-access-architecture.md §2).
 *
 * Gitea cannot hold a pending invitation or invite anyone by email, and an
 * unaccepted invitation is not evidence about a document — so, by ADR 0004's
 * own procedure, it is configuration and lives here. Losing the table loses
 * pending invitations and no access: membership itself is only ever Gitea's
 * team membership.
 *
 * - **Grants nothing until it is accepted.** Acceptance is what adds the
 *   person to the organization's teams, in Gitea.
 * - **Bound to the address.** Only an account whose email is the invited one
 *   can accept, so a forwarded link is not a key.
 * - **Joined as an owner.** The add is made with an owner's own session token,
 *   never the service account's. If no owner of the organization is signed in
 *   when it is accepted, it waits (`accepted_at` set, `joined_at` not) and
 *   finishes as soon as one is.
 *
 * Only a SHA-256 of the link's token is kept, like a password reset's.
 */
export const organizationInvitations = sqliteTable(
  "organization_invitations",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    giteaOrgId: integer("gitea_org_id").notNull(),
    /** For display and Gitea calls; the id above is the identity. */
    orgName: text("org_name").notNull(),
    email: text("email").notNull(),
    /** `owner` or `member`. */
    orgRole: text("org_role").notNull(),
    /** A binder to land them in, and at which level, or null for neither. */
    binder: text("binder"),
    binderLevel: text("binder_level"),
    invitedBy: text("invited_by").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    acceptedAt: integer("accepted_at"),
    acceptedBy: text("accepted_by"),
    joinedAt: integer("joined_at"),
  },
  (table) => [
    index("idx_organization_invitations_org").on(table.giteaOrgId),
    index("idx_organization_invitations_waiting").on(
      table.acceptedAt,
      table.joinedAt,
    ),
  ],
);
