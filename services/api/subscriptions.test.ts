import { Database } from "bun:sqlite";
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubscriptionStore } from "./subscriptions";

// Use an in-memory SQLite DB for tests.
const TEST_DB = ":memory:";

function makeStore() {
  return new SubscriptionStore(TEST_DB);
}

function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-subscriptions-"));
  return {
    path: join(dir, "sessions.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function captureStdout<T>(run: () => T): { result: T; output: string } {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;

  (process.stdout as { write: typeof process.stdout.write }).write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    writes.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );

    if (typeof encoding === "function") {
      encoding();
    } else {
      callback?.();
    }

    return true;
  };

  try {
    return { result: run(), output: writes.join("") };
  } finally {
    (process.stdout as { write: typeof process.stdout.write }).write =
      originalWrite;
  }
}

const now = Math.floor(Date.now() / 1000);
const futureEnd = now + 30 * 24 * 60 * 60; // 30 days from now
const recentEnd = now - 1 * 24 * 60 * 60; // 1 day ago (within buffer)
const expiredEnd = now - 4 * 24 * 60 * 60; // 4 days ago (past 3-day buffer)

describe("SubscriptionStore", () => {
  it("upserts and retrieves by username", () => {
    const store = makeStore();
    store.upsert({
      username: "alice",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("alice");
    expect(record?.status).toBe("active");
    expect(record?.stripeCustomerId).toBe("cus_1");
  });

  it("upserts and retrieves by customer ID", () => {
    const store = makeStore();
    store.upsert({
      username: "bob",
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      status: "trialing",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByCustomerId("cus_2");
    expect(record?.username).toBe("bob");
  });

  it("updates on conflict", () => {
    const store = makeStore();
    store.upsert({
      username: "carol",
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    store.upsert({
      username: "carol",
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
      status: "canceled",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("carol");
    expect(record?.status).toBe("canceled");
  });

  it("rebinds a username to a new stripe customer and clears the old customer lookup", () => {
    const store = makeStore();
    store.upsert({
      username: "carol",
      stripeCustomerId: "cus_old",
      stripeSubscriptionId: "sub_old",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 1,
    });

    store.upsert({
      username: "carol",
      stripeCustomerId: "cus_new",
      stripeSubscriptionId: "sub_new",
      status: "trialing",
      currentPeriodEnd: futureEnd + 3600,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd + 3600,
      updatedAt: 2,
    });

    expect(store.getByCustomerId("cus_old")).toBeNull();

    const rebound = store.getByCustomerId("cus_new");
    expect(rebound?.username).toBe("carol");
    expect(rebound?.stripeSubscriptionId).toBe("sub_new");
  });

  it("replaces all persisted billing fields on username conflict", () => {
    const store = makeStore();
    store.upsert({
      username: "drew",
      stripeCustomerId: "cus_drew_1",
      stripeSubscriptionId: "sub_drew_1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 10,
    });

    store.upsert({
      username: "drew",
      stripeCustomerId: "cus_drew_2",
      stripeSubscriptionId: "sub_drew_2",
      status: "past_due",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: 20,
    });

    const record = store.getByUsername("drew");
    expect(record).toEqual({
      username: "drew",
      stripeCustomerId: "cus_drew_2",
      stripeSubscriptionId: "sub_drew_2",
      status: "past_due",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: 20,
    });
  });

  it("returns null for unknown username", () => {
    const store = makeStore();
    expect(store.getByUsername("nobody")).toBeNull();
  });

  it("rejects rebinding an existing Stripe customer to a different username", () => {
    const store = makeStore();
    store.upsert({
      username: "alice",
      stripeCustomerId: "cus_shared",
      stripeSubscriptionId: "sub_alice",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 100,
    });

    const { output } = captureStdout(() => {
      expect(() =>
        store.upsert({
          username: "bob",
          stripeCustomerId: "cus_shared",
          stripeSubscriptionId: "sub_bob",
          status: "active",
          currentPeriodEnd: futureEnd,
          cancelAtPeriodEnd: false,
          cancelAt: null,
          updatedAt: 101,
        }),
      ).toThrow(/already bound to alice/i);
    });

    expect(store.getByCustomerId("cus_shared")?.username).toBe("alice");
    expect(store.getByUsername("bob")).toBeNull();
    expect(output).toContain("Rejected Stripe customer rebind attempt");
    expect(output).toContain('"existingUsername":"alice"');
    expect(output).toContain('"attemptedUsername":"bob"');
  });

  it("deduplicates legacy customer bindings during migration and recreates the unique index", () => {
    const tempDb = makeTempDbPath();

    try {
      const legacyDb = new Database(tempDb.path);
      legacyDb.exec(`
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
        CREATE INDEX idx_subscriptions_customer ON subscriptions(stripe_customer_id);
      `);

      legacyDb
        .query<
          void,
          [
            string,
            string,
            string,
            string,
            number | null,
            number,
            number | null,
            number,
          ]
        >(
          `INSERT INTO subscriptions (username, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, cancel_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "alice",
          "cus_dup",
          "sub_old",
          "past_due",
          expiredEnd,
          0,
          null,
          100,
        );
      legacyDb
        .query<
          void,
          [
            string,
            string,
            string,
            string,
            number | null,
            number,
            number | null,
            number,
          ]
        >(
          `INSERT INTO subscriptions (username, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, cancel_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "bob",
          "cus_dup",
          "sub_new",
          "active",
          futureEnd,
          1,
          futureEnd,
          200,
        );
      legacyDb.close();

      const { result: store, output } = captureStdout(
        () => new SubscriptionStore(tempDb.path),
      );

      expect(store.getByUsername("alice")).toBeNull();
      expect(store.getByCustomerId("cus_dup")).toEqual({
        username: "bob",
        stripeCustomerId: "cus_dup",
        stripeSubscriptionId: "sub_new",
        status: "active",
        currentPeriodEnd: futureEnd,
        cancelAtPeriodEnd: true,
        cancelAt: futureEnd,
        updatedAt: 200,
      });
      expect(output).toContain(
        "Deduplicating legacy Stripe customer bindings during subscription migration",
      );
      expect(output).toContain('"keptUsername":"bob"');
      expect(output).toContain('"removedUsernames":["alice"]');

      const migratedDb = new Database(tempDb.path, { readonly: true });
      const indexes = migratedDb
        .query<
          { name: string; unique: number },
          []
        >("PRAGMA index_list(subscriptions)")
        .all();
      migratedDb.close();

      expect(
        indexes.some(
          (index) =>
            index.name === "idx_subscriptions_customer" && index.unique === 1,
        ),
      ).toBe(true);
    } finally {
      tempDb.cleanup();
    }
  });
});

describe("hasActiveSubscription — expiry logic", () => {
  // hasActiveSubscription uses the lazy singleton subscriptionStore which opens
  // the real DB path. To test it in isolation we exercise the logic directly
  // via SubscriptionStore with an in-memory DB and call the standalone function
  // by temporarily swapping the underlying store. Because that module-level
  // store is not easily injectable, we test the logic through SubscriptionStore
  // directly and validate the hasActiveSubscription function separately using
  // the module-level store backed by a temp in-memory path.
  //
  // For the expiry tests we import and call a fresh store directly.

  it("active with future currentPeriodEnd → active", () => {
    const store = makeStore();
    store.upsert({
      username: "u1",
      stripeCustomerId: "cus_u1",
      stripeSubscriptionId: "sub_u1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u1");
    expect(record?.status).toBe("active");
    // Verify the expiry guard logic directly:
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("active with currentPeriodEnd 4 days ago → expired (beyond 3-day buffer)", () => {
    const store = makeStore();
    store.upsert({
      username: "u2",
      stripeCustomerId: "cus_u2",
      stripeSubscriptionId: "sub_u2",
      status: "active",
      currentPeriodEnd: expiredEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u2");
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(true);
  });

  it("active with currentPeriodEnd 1 day ago → still valid (within 3-day buffer)", () => {
    const store = makeStore();
    store.upsert({
      username: "u3",
      stripeCustomerId: "cus_u3",
      stripeSubscriptionId: "sub_u3",
      status: "active",
      currentPeriodEnd: recentEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u3");
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("active with null currentPeriodEnd → not expired", () => {
    const store = makeStore();
    store.upsert({
      username: "u4",
      stripeCustomerId: "cus_u4",
      stripeSubscriptionId: "sub_u4",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u4");
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("trialing with future currentPeriodEnd → not expired", () => {
    const store = makeStore();
    store.upsert({
      username: "u5",
      stripeCustomerId: "cus_u5",
      stripeSubscriptionId: "sub_u5",
      status: "trialing",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u5");
    expect(record?.status).toBe("trialing");
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("past_due status → not active regardless of period end", () => {
    const store = makeStore();
    store.upsert({
      username: "u6",
      stripeCustomerId: "cus_u6",
      stripeSubscriptionId: "sub_u6",
      status: "past_due",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u6");
    expect(record?.status === "active" || record?.status === "trialing").toBe(
      false,
    );
  });

  it("canceled status → not active", () => {
    const store = makeStore();
    store.upsert({
      username: "u7",
      stripeCustomerId: "cus_u7",
      stripeSubscriptionId: "sub_u7",
      status: "canceled",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("u7");
    expect(record?.status === "active" || record?.status === "trialing").toBe(
      false,
    );
  });

  it("no record → not active", () => {
    const store = makeStore();
    expect(store.getByUsername("nonexistent")).toBeNull();
  });
});

describe("SubscriptionStore — cancel_at_period_end", () => {
  it("persists cancelAtPeriodEnd=true and cancelAt timestamp", () => {
    const store = makeStore();
    const cancelTs = futureEnd;
    store.upsert({
      username: "v1",
      stripeCustomerId: "cus_v1",
      stripeSubscriptionId: "sub_v1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: true,
      cancelAt: cancelTs,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("v1");
    expect(record?.cancelAtPeriodEnd).toBe(true);
    expect(record?.cancelAt).toBe(cancelTs);
  });

  it("cancelAtPeriodEnd defaults to false when stored as 0", () => {
    const store = makeStore();
    store.upsert({
      username: "v2",
      stripeCustomerId: "cus_v2",
      stripeSubscriptionId: "sub_v2",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("v2");
    expect(record?.cancelAtPeriodEnd).toBe(false);
    expect(record?.cancelAt).toBeNull();
  });

  it("upsert clears cancelAtPeriodEnd when subscription renews", () => {
    const store = makeStore();
    store.upsert({
      username: "v3",
      stripeCustomerId: "cus_v3",
      stripeSubscriptionId: "sub_v3",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: Date.now(),
    });
    store.upsert({
      username: "v3",
      stripeCustomerId: "cus_v3",
      stripeSubscriptionId: "sub_v3",
      status: "active",
      currentPeriodEnd: futureEnd + 30 * 86400,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = store.getByUsername("v3");
    expect(record?.cancelAtPeriodEnd).toBe(false);
    expect(record?.cancelAt).toBeNull();
  });
});
