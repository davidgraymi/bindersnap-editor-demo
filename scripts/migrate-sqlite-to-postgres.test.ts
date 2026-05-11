import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPlan,
  dedupeSubscriptionsByCustomerId,
  filterLiveSessions,
  parseCliArgs,
  readSqliteSnapshot,
  type SourceSubscriptionRow,
} from "./migrate-sqlite-to-postgres";

function makeSubscription(
  overrides: Partial<SourceSubscriptionRow>,
): SourceSubscriptionRow {
  return {
    username: "alice",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    currentPeriodEnd: 1000,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    updatedAt: 100,
    ...overrides,
  };
}

describe("filterLiveSessions", () => {
  test("drops sessions whose expires_at is at or before now", () => {
    const now = 10_000;
    const result = filterLiveSessions(
      [
        {
          id: "live",
          username: "u",
          giteaToken: "t",
          giteaTokenName: "n",
          createdAt: 0,
          expiresAt: 11_000,
        },
        {
          id: "expired-eq",
          username: "u",
          giteaToken: "t",
          giteaTokenName: "n",
          createdAt: 0,
          expiresAt: 10_000,
        },
        {
          id: "expired-lt",
          username: "u",
          giteaToken: "t",
          giteaTokenName: "n",
          createdAt: 0,
          expiresAt: 9_999,
        },
      ],
      now,
    );
    expect(result.live.map((s) => s.id)).toEqual(["live"]);
    expect(result.expired).toBe(2);
  });
});

describe("dedupeSubscriptionsByCustomerId", () => {
  test("keeps the row with the largest updated_at when stripe_customer_id repeats", () => {
    const older = makeSubscription({ username: "alice", updatedAt: 50 });
    const newer = makeSubscription({ username: "bob", updatedAt: 200 });
    const result = dedupeSubscriptionsByCustomerId([older, newer]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.username).toBe("bob");
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.username).toBe("alice");
  });

  test("breaks ties on updated_at by username for determinism", () => {
    const aliceTie = makeSubscription({ username: "alice", updatedAt: 100 });
    const bobTie = makeSubscription({ username: "bob", updatedAt: 100 });
    const result = dedupeSubscriptionsByCustomerId([bobTie, aliceTie]);
    expect(result.kept[0]!.username).toBe("alice");
    expect(result.dropped[0]!.username).toBe("bob");
  });

  test("preserves rows with distinct stripe_customer_id values", () => {
    const a = makeSubscription({
      username: "alice",
      stripeCustomerId: "cus_a",
    });
    const b = makeSubscription({ username: "bob", stripeCustomerId: "cus_b" });
    const result = dedupeSubscriptionsByCustomerId([a, b]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });
});

describe("buildPlan", () => {
  test("composes filter + dedupe + passthrough into a single plan", () => {
    const plan = buildPlan(
      {
        sessions: [
          {
            id: "live",
            username: "u",
            giteaToken: "t",
            giteaTokenName: "n",
            createdAt: 0,
            expiresAt: 11_000,
          },
          {
            id: "expired",
            username: "u",
            giteaToken: "t",
            giteaTokenName: "n",
            createdAt: 0,
            expiresAt: 5_000,
          },
        ],
        subscriptions: [
          makeSubscription({ username: "old", updatedAt: 1 }),
          makeSubscription({ username: "new", updatedAt: 2 }),
        ],
        subscriptionAccessOverrides: [
          {
            username: "x",
            access: "grant",
            reason: null,
            updatedBy: "admin",
            updatedAt: 1,
          },
        ],
        processedWebhookEvents: [
          {
            eventId: "evt_1",
            eventType: "test",
            customerId: null,
            createdAt: 0,
            processedAt: 0,
          },
        ],
        webhookCustomerState: [{ customerId: "cus_1", lastEventCreatedAt: 0 }],
      },
      10_000,
    );
    expect(plan.sessions).toHaveLength(1);
    expect(plan.expiredSessions).toBe(1);
    expect(plan.subscriptions).toHaveLength(1);
    expect(plan.subscriptions[0]!.username).toBe("new");
    expect(plan.subscriptionDuplicatesDropped).toHaveLength(1);
    expect(plan.subscriptionAccessOverrides).toHaveLength(1);
    expect(plan.processedWebhookEvents).toHaveLength(1);
    expect(plan.webhookCustomerState).toHaveLength(1);
  });
});

describe("parseCliArgs", () => {
  test("parses all flags", () => {
    const args = parseCliArgs([
      "--sqlite-path",
      "/tmp/s.db",
      "--database-url",
      "postgres://x",
      "--dry-run",
      "--allow-non-empty",
    ]);
    expect(args).toEqual({
      sqlitePath: "/tmp/s.db",
      databaseUrl: "postgres://x",
      dryRun: true,
      allowNonEmpty: true,
    });
  });

  test("rejects unknown args", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow(/Unknown argument/);
  });

  test("defaults are nulls / falses when no flags provided", () => {
    expect(parseCliArgs([])).toEqual({
      sqlitePath: null,
      databaseUrl: null,
      dryRun: false,
      allowNonEmpty: false,
    });
  });
});

describe("readSqliteSnapshot", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "migrate-sqlite-"));
    dbPath = join(tempDir, "sessions.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns shaped rows for all five tables", () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        gitea_token TEXT NOT NULL,
        gitea_token_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE subscriptions (
        username TEXT PRIMARY KEY,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end INTEGER,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        cancel_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE subscription_access_overrides (
        username TEXT PRIMARY KEY,
        access TEXT NOT NULL,
        reason TEXT,
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE processed_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        customer_id TEXT,
        created_at INTEGER NOT NULL,
        processed_at INTEGER NOT NULL
      );
      CREATE TABLE webhook_customer_state (
        customer_id TEXT PRIMARY KEY,
        last_event_created_at INTEGER NOT NULL
      );
    `);
    db.run("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)", [
      "sess_1",
      "alice",
      "tok",
      "tok-name",
      100,
      200,
    ]);
    db.run("INSERT INTO subscriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      "alice",
      "cus_1",
      "sub_1",
      "active",
      1000,
      1,
      null,
      50,
    ]);
    db.run("INSERT INTO subscription_access_overrides VALUES (?, ?, ?, ?, ?)", [
      "bob",
      "grant",
      "vip",
      "admin",
      75,
    ]);
    db.run("INSERT INTO processed_webhook_events VALUES (?, ?, ?, ?, ?)", [
      "evt_1",
      "customer.subscription.updated",
      "cus_1",
      10,
      11,
    ]);
    db.run("INSERT INTO webhook_customer_state VALUES (?, ?)", ["cus_1", 10]);
    db.close();

    const snapshot = readSqliteSnapshot(dbPath);
    expect(snapshot.sessions[0]).toEqual({
      id: "sess_1",
      username: "alice",
      giteaToken: "tok",
      giteaTokenName: "tok-name",
      createdAt: 100,
      expiresAt: 200,
    });
    expect(snapshot.subscriptions[0]).toEqual({
      username: "alice",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: 1000,
      cancelAtPeriodEnd: true,
      cancelAt: null,
      updatedAt: 50,
    });
    expect(snapshot.subscriptionAccessOverrides[0]!.username).toBe("bob");
    expect(snapshot.processedWebhookEvents[0]!.eventId).toBe("evt_1");
    expect(snapshot.webhookCustomerState[0]!.customerId).toBe("cus_1");
  });

  test("tolerates a sessions-only legacy database (other tables missing)", () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        gitea_token TEXT NOT NULL,
        gitea_token_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    db.close();

    const snapshot = readSqliteSnapshot(dbPath);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.subscriptions).toEqual([]);
    expect(snapshot.subscriptionAccessOverrides).toEqual([]);
    expect(snapshot.processedWebhookEvents).toEqual([]);
    expect(snapshot.webhookCustomerState).toEqual([]);
  });
});
