#!/usr/bin/env bun

// One-shot copy of the API service's SQLite store into Postgres.
//
// Reads rows from the existing on-disk SQLite database (the EC2 host's
// `sessions.db` carries all five tables — sessions, subscriptions,
// subscription_access_overrides, processed_webhook_events,
// webhook_customer_state) and inserts them into the Postgres database whose
// schema has already been brought up to date by the standalone migration
// runner.
//
// Usage:
//   bun run scripts/migrate-sqlite-to-postgres.ts \
//     --sqlite-path /var/lib/bindersnap/sessions.db \
//     --database-url "$BINDERSNAP_DATABASE_URL" \
//     --token-encryption-key "$BINDERSNAP_TOKEN_ENCRYPTION_KEY"
//
// Flags:
//   --sqlite-path <path>     Source SQLite file. Required.
//   --database-url <url>     Target Postgres URL. Defaults to env BINDERSNAP_DATABASE_URL.
//   --token-encryption-key <b64>
//                            Master key for token-at-rest envelope encryption.
//                            Defaults to env BINDERSNAP_TOKEN_ENCRYPTION_KEY.
//   --dry-run                Read + plan only; no writes.
//   --allow-non-empty        Allow writing into tables that already have rows.
//                            By default the script refuses, since it is meant
//                            as a one-shot pre-cutover copy.
//   --now <ms>               Override "now" used to filter expired sessions
//                            (test hook).
//
// Exit status:
//   0  Copy completed (or dry-run printed the plan).
//   1  Refused (schema mismatch, destination not empty, missing input, etc.).

import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  processedWebhookEvents,
  sessions,
  subscriptionAccessOverrides,
  subscriptions,
  webhookCustomerState,
} from "../services/api/db/schema";
import {
  EXPECTED_SCHEMA_VERSION,
  assertSchemaVersionMatches,
} from "../services/api/db/version";
import {
  LocalTokenCrypto,
  type TokenCrypto,
} from "../services/api/token-crypto";

export interface SourceSessionRow {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
}

export interface SourceSubscriptionRow {
  username: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  updatedAt: number;
}

export interface SourceSubscriptionOverrideRow {
  username: string;
  access: "grant" | "revoke";
  reason: string | null;
  updatedBy: string;
  updatedAt: number;
}

export interface SourceProcessedWebhookEventRow {
  eventId: string;
  eventType: string;
  customerId: string | null;
  createdAt: number;
  processedAt: number;
}

export interface SourceWebhookCustomerStateRow {
  customerId: string;
  lastEventCreatedAt: number;
}

export interface SourceSnapshot {
  sessions: SourceSessionRow[];
  subscriptions: SourceSubscriptionRow[];
  subscriptionAccessOverrides: SourceSubscriptionOverrideRow[];
  processedWebhookEvents: SourceProcessedWebhookEventRow[];
  webhookCustomerState: SourceWebhookCustomerStateRow[];
}

export interface MigrationPlan {
  sessions: SourceSessionRow[];
  expiredSessions: number;
  subscriptions: SourceSubscriptionRow[];
  subscriptionDuplicatesDropped: SourceSubscriptionRow[];
  subscriptionAccessOverrides: SourceSubscriptionOverrideRow[];
  processedWebhookEvents: SourceProcessedWebhookEventRow[];
  webhookCustomerState: SourceWebhookCustomerStateRow[];
}

export interface MigrationOptions {
  sqlitePath: string;
  databaseUrl: string;
  // Master key for token-at-rest envelope encryption. Required unless
  // `tokenCrypto` is passed explicitly (tests). Base64 of 32 bytes.
  tokenEncryptionKey?: string;
  // Override for tests so we don't have to round-trip a base64 string.
  tokenCrypto?: TokenCrypto;
  dryRun?: boolean;
  allowNonEmpty?: boolean;
  now?: number;
  logger?: (line: string) => void;
}

export interface MigrationResult {
  appliedVersion: string;
  written: {
    sessions: number;
    subscriptions: number;
    subscriptionAccessOverrides: number;
    processedWebhookEvents: number;
    webhookCustomerState: number;
  };
  skipped: {
    expiredSessions: number;
    duplicateSubscriptions: SourceSubscriptionRow[];
  };
  dryRun: boolean;
}

interface SqliteSessionRow {
  id: string;
  username: string;
  gitea_token: string;
  gitea_token_name: string;
  created_at: number;
  expires_at: number;
}

interface SqliteSubscriptionRow {
  username: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  cancel_at: number | null;
  updated_at: number;
}

interface SqliteSubscriptionOverrideRow {
  username: string;
  access: "grant" | "revoke";
  reason: string | null;
  updated_by: string;
  updated_at: number;
}

interface SqliteProcessedWebhookEventRow {
  event_id: string;
  event_type: string;
  customer_id: string | null;
  created_at: number;
  processed_at: number;
}

interface SqliteWebhookCustomerStateRow {
  customer_id: string;
  last_event_created_at: number;
}

export function readSqliteSnapshot(sqlitePath: string): SourceSnapshot {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const sessionRows = db
      .query<SqliteSessionRow, []>("SELECT * FROM sessions")
      .all()
      .map((row) => ({
        id: row.id,
        username: row.username,
        giteaToken: row.gitea_token,
        giteaTokenName: row.gitea_token_name,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }));

    const subscriptionRows = tableExists(db, "subscriptions")
      ? db
          .query<SqliteSubscriptionRow, []>("SELECT * FROM subscriptions")
          .all()
          .map((row) => ({
            username: row.username,
            stripeCustomerId: row.stripe_customer_id,
            stripeSubscriptionId: row.stripe_subscription_id,
            status: row.status,
            currentPeriodEnd: row.current_period_end,
            cancelAtPeriodEnd: row.cancel_at_period_end === 1,
            cancelAt: row.cancel_at,
            updatedAt: row.updated_at,
          }))
      : [];

    const overrideRows = tableExists(db, "subscription_access_overrides")
      ? db
          .query<SqliteSubscriptionOverrideRow, []>(
            "SELECT * FROM subscription_access_overrides",
          )
          .all()
          .map((row) => ({
            username: row.username,
            access: row.access,
            reason: row.reason,
            updatedBy: row.updated_by,
            updatedAt: row.updated_at,
          }))
      : [];

    const processedRows = tableExists(db, "processed_webhook_events")
      ? db
          .query<SqliteProcessedWebhookEventRow, []>(
            "SELECT * FROM processed_webhook_events",
          )
          .all()
          .map((row) => ({
            eventId: row.event_id,
            eventType: row.event_type,
            customerId: row.customer_id,
            createdAt: row.created_at,
            processedAt: row.processed_at,
          }))
      : [];

    const customerStateRows = tableExists(db, "webhook_customer_state")
      ? db
          .query<SqliteWebhookCustomerStateRow, []>(
            "SELECT * FROM webhook_customer_state",
          )
          .all()
          .map((row) => ({
            customerId: row.customer_id,
            lastEventCreatedAt: row.last_event_created_at,
          }))
      : [];

    return {
      sessions: sessionRows,
      subscriptions: subscriptionRows,
      subscriptionAccessOverrides: overrideRows,
      processedWebhookEvents: processedRows,
      webhookCustomerState: customerStateRows,
    };
  } finally {
    db.close();
  }
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query<
      { name: string },
      [string]
    >("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return row !== null;
}

// Drops sessions whose expires_at is at or before `now`. The SQLite reaper may
// not have run on the source for hours, and copying expired tokens into a new
// store wastes space and gives an attacker who reads the dump a longer window.
export function filterLiveSessions(
  rows: SourceSessionRow[],
  now: number,
): { live: SourceSessionRow[]; expired: number } {
  const live: SourceSessionRow[] = [];
  let expired = 0;
  for (const row of rows) {
    if (row.expiresAt <= now) {
      expired += 1;
      continue;
    }
    live.push(row);
  }
  return { live, expired };
}

// SQLite enforces uniqueness on stripe_customer_id at upsert time
// (`enforceUniqueCustomerBindings` in services/api/subscriptions.ts), but a
// historical snapshot may still contain a stale duplicate row from before
// that code landed. The Postgres schema has a UNIQUE INDEX on the column, so
// a copy attempt with duplicates would fail mid-transaction.
//
// Resolve duplicates here by picking the row with the largest updated_at
// (newest write wins, matching the SQLite migration logic). Stable tie-break
// by username so reruns are deterministic.
export function dedupeSubscriptionsByCustomerId(
  rows: SourceSubscriptionRow[],
): { kept: SourceSubscriptionRow[]; dropped: SourceSubscriptionRow[] } {
  const winners = new Map<string, SourceSubscriptionRow>();
  const dropped: SourceSubscriptionRow[] = [];
  for (const row of rows) {
    const existing = winners.get(row.stripeCustomerId);
    if (!existing) {
      winners.set(row.stripeCustomerId, row);
      continue;
    }
    const existingIsBetter =
      existing.updatedAt > row.updatedAt ||
      (existing.updatedAt === row.updatedAt &&
        existing.username.localeCompare(row.username) <= 0);
    if (existingIsBetter) {
      dropped.push(row);
    } else {
      dropped.push(existing);
      winners.set(row.stripeCustomerId, row);
    }
  }
  return { kept: [...winners.values()], dropped };
}

export function buildPlan(
  snapshot: SourceSnapshot,
  now: number,
): MigrationPlan {
  const { live, expired } = filterLiveSessions(snapshot.sessions, now);
  const { kept, dropped } = dedupeSubscriptionsByCustomerId(
    snapshot.subscriptions,
  );
  return {
    sessions: live,
    expiredSessions: expired,
    subscriptions: kept,
    subscriptionDuplicatesDropped: dropped,
    subscriptionAccessOverrides: snapshot.subscriptionAccessOverrides,
    processedWebhookEvents: snapshot.processedWebhookEvents,
    webhookCustomerState: snapshot.webhookCustomerState,
  };
}

interface DestinationCounts {
  sessions: number;
  subscriptions: number;
  subscriptionAccessOverrides: number;
  processedWebhookEvents: number;
  webhookCustomerState: number;
}

async function readDestinationCounts(
  db: PostgresJsDatabase,
): Promise<DestinationCounts> {
  const result = await db.execute<{
    sessions: string;
    subscriptions: string;
    overrides: string;
    processed: string;
    customer_state: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM ${sessions}) AS sessions,
      (SELECT COUNT(*)::text FROM ${subscriptions}) AS subscriptions,
      (SELECT COUNT(*)::text FROM ${subscriptionAccessOverrides}) AS overrides,
      (SELECT COUNT(*)::text FROM ${processedWebhookEvents}) AS processed,
      (SELECT COUNT(*)::text FROM ${webhookCustomerState}) AS customer_state
  `);
  const row = (result as unknown as Array<Record<string, string>>)[0];
  if (!row) {
    throw new Error("Postgres count query returned no rows.");
  }
  return {
    sessions: Number(row.sessions),
    subscriptions: Number(row.subscriptions),
    subscriptionAccessOverrides: Number(row.overrides),
    processedWebhookEvents: Number(row.processed),
    webhookCustomerState: Number(row.customer_state),
  };
}

function totalRows(counts: DestinationCounts): number {
  return (
    counts.sessions +
    counts.subscriptions +
    counts.subscriptionAccessOverrides +
    counts.processedWebhookEvents +
    counts.webhookCustomerState
  );
}

export class DestinationNotEmptyError extends Error {
  constructor(public readonly counts: DestinationCounts) {
    super(
      `Destination Postgres database already has rows: ${JSON.stringify(counts)}. ` +
        `Pass --allow-non-empty to copy anyway (rows that conflict on PK are skipped).`,
    );
    this.name = "DestinationNotEmptyError";
  }
}

// Writes the plan into Postgres inside a single transaction. ON CONFLICT DO
// NOTHING means re-running the script after a partial success is safe — rows
// already present are not overwritten.
//
// Session rows are envelope-encrypted before insertion: each row gets a
// per-session DEK wrapped by the master key supplied via `crypto`. The raw
// plaintext giteaToken from SQLite never lands in Postgres.
export async function writePlan(
  db: PostgresJsDatabase,
  plan: MigrationPlan,
  crypto: TokenCrypto,
): Promise<MigrationResult["written"]> {
  const written: MigrationResult["written"] = {
    sessions: 0,
    subscriptions: 0,
    subscriptionAccessOverrides: 0,
    processedWebhookEvents: 0,
    webhookCustomerState: 0,
  };

  const encryptedSessionRows = await Promise.all(
    plan.sessions.map(async (row) => {
      const { ciphertext, wrappedDek } = await crypto.encrypt(row.giteaToken);
      return {
        id: row.id,
        username: row.username,
        giteaTokenCiphertext: ciphertext,
        giteaTokenDek: wrappedDek,
        giteaTokenName: row.giteaTokenName,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    }),
  );

  await db.transaction(async (tx) => {
    if (encryptedSessionRows.length > 0) {
      const inserted = await tx
        .insert(sessions)
        .values(encryptedSessionRows)
        .onConflictDoNothing({ target: sessions.id })
        .returning({ id: sessions.id });
      written.sessions = inserted.length;
    }

    if (plan.subscriptions.length > 0) {
      const inserted = await tx
        .insert(subscriptions)
        .values(plan.subscriptions)
        .onConflictDoNothing({ target: subscriptions.username })
        .returning({ username: subscriptions.username });
      written.subscriptions = inserted.length;
    }

    if (plan.subscriptionAccessOverrides.length > 0) {
      const inserted = await tx
        .insert(subscriptionAccessOverrides)
        .values(plan.subscriptionAccessOverrides)
        .onConflictDoNothing({ target: subscriptionAccessOverrides.username })
        .returning({ username: subscriptionAccessOverrides.username });
      written.subscriptionAccessOverrides = inserted.length;
    }

    if (plan.processedWebhookEvents.length > 0) {
      const inserted = await tx
        .insert(processedWebhookEvents)
        .values(plan.processedWebhookEvents)
        .onConflictDoNothing({ target: processedWebhookEvents.eventId })
        .returning({ eventId: processedWebhookEvents.eventId });
      written.processedWebhookEvents = inserted.length;
    }

    if (plan.webhookCustomerState.length > 0) {
      const inserted = await tx
        .insert(webhookCustomerState)
        .values(plan.webhookCustomerState)
        .onConflictDoNothing({ target: webhookCustomerState.customerId })
        .returning({ customerId: webhookCustomerState.customerId });
      written.webhookCustomerState = inserted.length;
    }
  });

  return written;
}

export async function runMigration(
  options: MigrationOptions,
): Promise<MigrationResult> {
  const log = options.logger ?? ((line) => console.log(line));
  const now = options.now ?? Date.now();

  const crypto =
    options.tokenCrypto ??
    (options.tokenEncryptionKey
      ? LocalTokenCrypto.fromBase64(options.tokenEncryptionKey)
      : null);
  if (!crypto) {
    throw new Error(
      "tokenEncryptionKey (or tokenCrypto) is required to copy sessions into Postgres.",
    );
  }

  const snapshot = readSqliteSnapshot(options.sqlitePath);
  const plan = buildPlan(snapshot, now);

  log(
    `Read SQLite snapshot: sessions=${snapshot.sessions.length} (live=${plan.sessions.length}, expired=${plan.expiredSessions}), ` +
      `subscriptions=${snapshot.subscriptions.length} (kept=${plan.subscriptions.length}, dropped=${plan.subscriptionDuplicatesDropped.length}), ` +
      `overrides=${plan.subscriptionAccessOverrides.length}, ` +
      `webhook_events=${plan.processedWebhookEvents.length}, ` +
      `webhook_customer_state=${plan.webhookCustomerState.length}`,
  );

  if (plan.subscriptionDuplicatesDropped.length > 0) {
    for (const dup of plan.subscriptionDuplicatesDropped) {
      log(
        `  dropped duplicate subscription: stripe_customer_id=${dup.stripeCustomerId} ` +
          `username=${dup.username} updated_at=${dup.updatedAt}`,
      );
    }
  }

  const client = postgres(options.databaseUrl, { max: 1, prepare: false });
  try {
    const db = drizzle(client);

    await assertSchemaVersionMatches(db);

    const counts = await readDestinationCounts(db);
    if (totalRows(counts) > 0 && !options.allowNonEmpty) {
      throw new DestinationNotEmptyError(counts);
    }

    if (options.dryRun) {
      log("Dry-run requested; not writing rows.");
      return {
        appliedVersion: EXPECTED_SCHEMA_VERSION,
        written: {
          sessions: 0,
          subscriptions: 0,
          subscriptionAccessOverrides: 0,
          processedWebhookEvents: 0,
          webhookCustomerState: 0,
        },
        skipped: {
          expiredSessions: plan.expiredSessions,
          duplicateSubscriptions: plan.subscriptionDuplicatesDropped,
        },
        dryRun: true,
      };
    }

    const written = await writePlan(db, plan, crypto);

    log(
      `Wrote: sessions=${written.sessions}, subscriptions=${written.subscriptions}, ` +
        `overrides=${written.subscriptionAccessOverrides}, ` +
        `webhook_events=${written.processedWebhookEvents}, ` +
        `webhook_customer_state=${written.webhookCustomerState}`,
    );

    return {
      appliedVersion: EXPECTED_SCHEMA_VERSION,
      written,
      skipped: {
        expiredSessions: plan.expiredSessions,
        duplicateSubscriptions: plan.subscriptionDuplicatesDropped,
      },
      dryRun: false,
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

interface CliArgs {
  sqlitePath: string | null;
  databaseUrl: string | null;
  tokenEncryptionKey: string | null;
  dryRun: boolean;
  allowNonEmpty: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    sqlitePath: null,
    databaseUrl: null,
    tokenEncryptionKey: null,
    dryRun: false,
    allowNonEmpty: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sqlite-path") {
      args.sqlitePath = argv[++i] ?? null;
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[++i] ?? null;
    } else if (arg === "--token-encryption-key") {
      args.tokenEncryptionKey = argv[++i] ?? null;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--allow-non-empty") {
      args.allowNonEmpty = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

if (import.meta.main) {
  const cli = parseCliArgs(process.argv.slice(2));
  const sqlitePath = cli.sqlitePath;
  const databaseUrl = cli.databaseUrl ?? process.env.BINDERSNAP_DATABASE_URL;
  const tokenEncryptionKey =
    cli.tokenEncryptionKey ?? process.env.BINDERSNAP_TOKEN_ENCRYPTION_KEY;
  if (!sqlitePath) {
    console.error("--sqlite-path is required.");
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error("--database-url or BINDERSNAP_DATABASE_URL is required.");
    process.exit(1);
  }
  if (!tokenEncryptionKey) {
    console.error(
      "--token-encryption-key or BINDERSNAP_TOKEN_ENCRYPTION_KEY is required.",
    );
    process.exit(1);
  }
  runMigration({
    sqlitePath,
    databaseUrl,
    tokenEncryptionKey,
    dryRun: cli.dryRun,
    allowNonEmpty: cli.allowNonEmpty,
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
