import { Database } from "bun:sqlite";
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrganizationStore } from "./organizations";
import { SubscriptionStore } from "./subscriptions";

// Use an in-memory SQLite DB for tests.
const TEST_DB = ":memory:";

function makeStore() {
  // The store reads the organizations table for the trial layer, so it needs an
  // organization backend. `:memory:` gives each connection its own database,
  // which is exactly right here: no organization has a trial, so access comes
  // only from Stripe and from admin overrides.
  return new SubscriptionStore(TEST_DB, new OrganizationStore(TEST_DB));
}

/**
 * A subscription store and an organization store over one file, so the trial
 * layer of `resolveAccess` can actually be exercised.
 */
function makeStorePair() {
  const temp = makeTempDbPath();
  const organizations = new OrganizationStore(temp.path);
  const store = new SubscriptionStore(temp.path, organizations);
  return { store, organizations, cleanup: temp.cleanup };
}

function makeTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-subscriptions-"));
  return {
    path: join(dir, "sessions.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function captureStdout<T>(
  run: () => T | Promise<T>,
): Promise<{ result: T; output: string }> {
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
    return { result: await run(), output: writes.join("") };
  } finally {
    (process.stdout as { write: typeof process.stdout.write }).write =
      originalWrite;
  }
}

// Billing keys to the organization (ADR 0004); these ids stand in for real
// Gitea org ids, one per fixture that used to be named by a person.
const ORG: Record<string, number> = {
  alice: 1000,
  bob: 1001,
  carol: 1002,
  drew: 1003,
  "override-only": 1004,
  "override-user": 1005,
  "stripe-only": 1006,
  "stripe-user": 1007,
  u1: 1008,
  u2: 1009,
  u3: 1010,
  u4: 1011,
  u5: 1012,
  u6: 1013,
  u7: 1014,
  v1: 1015,
  v2: 1016,
  v3: 1017,
  nobody: 1018,
  nonexistent: 1019,
};

const now = Math.floor(Date.now() / 1000);
const futureEnd = now + 30 * 24 * 60 * 60; // 30 days from now
const recentEnd = now - 1 * 24 * 60 * 60; // 1 day ago (within buffer)
const expiredEnd = now - 4 * 24 * 60 * 60; // 4 days ago (past 3-day buffer)

describe("SubscriptionStore", () => {
  it("upserts and retrieves by username", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["alice"],
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["alice"]);
    expect(record?.status).toBe("active");
    expect(record?.stripeCustomerId).toBe("cus_1");
  });

  it("upserts and retrieves by customer ID", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["bob"],
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      status: "trialing",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByCustomerId("cus_2");
    expect(record?.giteaOrgId).toBe(ORG["bob"]);
  });

  it("updates on conflict", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["carol"],
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    await store.upsert({
      giteaOrgId: ORG["carol"],
      stripeCustomerId: "cus_3",
      stripeSubscriptionId: "sub_3",
      status: "canceled",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["carol"]);
    expect(record?.status).toBe("canceled");
  });

  it("rebinds an organization to a new stripe customer and clears the old customer lookup", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["carol"],
      stripeCustomerId: "cus_old",
      stripeSubscriptionId: "sub_old",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 1,
    });

    await store.upsert({
      giteaOrgId: ORG["carol"],
      stripeCustomerId: "cus_new",
      stripeSubscriptionId: "sub_new",
      status: "trialing",
      currentPeriodEnd: futureEnd + 3600,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd + 3600,
      updatedAt: 2,
    });

    expect(await store.getByCustomerId("cus_old")).toBeNull();

    const rebound = await store.getByCustomerId("cus_new");
    expect(rebound?.giteaOrgId).toBe(ORG["carol"]);
    expect(rebound?.stripeSubscriptionId).toBe("sub_new");
  });

  it("replaces all persisted billing fields on organization conflict", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["drew"],
      stripeCustomerId: "cus_drew_1",
      stripeSubscriptionId: "sub_drew_1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 10,
    });

    await store.upsert({
      giteaOrgId: ORG["drew"],
      stripeCustomerId: "cus_drew_2",
      stripeSubscriptionId: "sub_drew_2",
      status: "past_due",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: 20,
    });

    const record = await store.getByOrganization(ORG["drew"]);
    expect(record).toEqual({
      giteaOrgId: ORG["drew"],
      stripeCustomerId: "cus_drew_2",
      stripeSubscriptionId: "sub_drew_2",
      status: "past_due",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: 20,
    });
  });

  it("returns null for an unknown organization", async () => {
    const store = makeStore();
    expect(await store.getByOrganization(ORG["nobody"])).toBeNull();
  });

  it("rejects rebinding an existing Stripe customer to a different organization", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["alice"],
      stripeCustomerId: "cus_shared",
      stripeSubscriptionId: "sub_alice",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 100,
    });

    const { output } = await captureStdout(async () => {
      await expect(
        store.upsert({
          giteaOrgId: ORG["bob"],
          stripeCustomerId: "cus_shared",
          stripeSubscriptionId: "sub_bob",
          status: "active",
          currentPeriodEnd: futureEnd,
          cancelAtPeriodEnd: false,
          cancelAt: null,
          updatedAt: 101,
        }),
      ).rejects.toThrow(
        new RegExp(`already bound to organization ${ORG["alice"]}`, "i"),
      );
    });

    expect((await store.getByCustomerId("cus_shared"))?.giteaOrgId).toBe(
      ORG["alice"],
    );
    expect(await store.getByOrganization(ORG["bob"])).toBeNull();
    expect(output).toContain("Rejected Stripe customer rebind attempt");
    expect(output).toContain(`"existingGiteaOrgId":${ORG["alice"]}`);
    expect(output).toContain(`"attemptedGiteaOrgId":${ORG["bob"]}`);
  });

  it("parks legacy username-keyed rows instead of dropping them", async () => {
    const tempDb = makeTempDbPath();

    try {
      // A database as it stood before the re-key: keyed on username, which is
      // what production holds today.
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
        CREATE TABLE subscription_access_overrides (
          username TEXT PRIMARY KEY,
          access TEXT NOT NULL,
          reason TEXT,
          updated_by TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO subscriptions VALUES
          ('alice', 'cus_alice', 'sub_alice', 'active', 99999999, 0, NULL, 100);
        INSERT INTO subscription_access_overrides VALUES
          ('bob', 'grant', 'design partner', 'admin', 200);
      `);
      legacyDb.close();

      // Opening the store applies the migration.
      const store = new SubscriptionStore(tempDb.path);
      expect(await store.getByCustomerId("cus_alice")).toBeNull();

      const migratedDb = new Database(tempDb.path, { readonly: true });
      const parkedSubscriptions = migratedDb
        .query<{ username: string; stripe_customer_id: string }, []>(
          "SELECT username, stripe_customer_id FROM legacy_username_subscriptions",
        )
        .all();
      const parkedOverrides = migratedDb
        .query<{ username: string; access: string }, []>(
          "SELECT username, access FROM legacy_username_subscription_access_overrides",
        )
        .all();
      migratedDb.close();

      // Mapping a username to an organization needs Gitea, which SQL cannot
      // reach — so the migration keeps every row for the backfill rather than
      // guessing or discarding. Losing a paying customer's subscription to a
      // schema change is the one outcome this has to make impossible.
      expect(parkedSubscriptions).toEqual([
        { username: "alice", stripe_customer_id: "cus_alice" },
      ]);
      expect(parkedOverrides).toEqual([{ username: "bob", access: "grant" }]);
    } finally {
      tempDb.cleanup();
    }
  });

  it("deduplicates duplicate customer bindings and recreates the unique index", async () => {
    const tempDb = makeTempDbPath();

    try {
      // Migrate first, then drop the guard and force a duplicate in — the
      // shape a database would be in if two organizations had ever been bound
      // to one Stripe customer.
      new SubscriptionStore(tempDb.path);

      const seedDb = new Database(tempDb.path);
      seedDb.exec("DROP INDEX IF EXISTS idx_subscriptions_customer");
      seedDb.exec(`
        INSERT INTO subscriptions VALUES
          (${ORG["alice"]}, 'cus_dup', 'sub_old', 'past_due', ${expiredEnd}, 0, NULL, 100),
          (${ORG["bob"]}, 'cus_dup', 'sub_new', 'active', ${futureEnd}, 1, ${futureEnd}, 200);
      `);
      seedDb.close();

      const { result: store, output } = await captureStdout(
        () => new SubscriptionStore(tempDb.path),
      );

      // Newest write wins; the older binding is dropped and said so out loud.
      expect(await store.getByOrganization(ORG["alice"])).toBeNull();
      expect(await store.getByCustomerId("cus_dup")).toEqual({
        giteaOrgId: ORG["bob"],
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
      expect(output).toContain(`"keptGiteaOrgId":${ORG["bob"]}`);
      expect(output).toContain(`"removedGiteaOrgIds":[${ORG["alice"]}]`);

      const migratedDb = new Database(tempDb.path, { readonly: true });
      const indexes = migratedDb
        .query<{ name: string; unique: number }, []>(
          "PRAGMA index_list(subscriptions)",
        )
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

describe("organizationHasAccess — expiry logic", () => {
  // organizationHasAccess uses the lazy singleton subscriptionStore which opens
  // the real DB path. To test it in isolation we exercise the logic directly
  // via SubscriptionStore with an in-memory DB and call the standalone function
  // by temporarily swapping the underlying store. Because that module-level
  // store is not easily injectable, we test the logic through SubscriptionStore
  // directly and validate the organizationHasAccess function separately using
  // the module-level store backed by a temp in-memory path.
  //
  // For the expiry tests we import and call a fresh store directly.

  it("active with future currentPeriodEnd → active", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u1"],
      stripeCustomerId: "cus_u1",
      stripeSubscriptionId: "sub_u1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u1"]);
    expect(record?.status).toBe("active");
    // Verify the expiry guard logic directly:
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("active with currentPeriodEnd 4 days ago → expired (beyond 3-day buffer)", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u2"],
      stripeCustomerId: "cus_u2",
      stripeSubscriptionId: "sub_u2",
      status: "active",
      currentPeriodEnd: expiredEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u2"]);
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(true);
  });

  it("active with currentPeriodEnd 1 day ago → still valid (within 3-day buffer)", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u3"],
      stripeCustomerId: "cus_u3",
      stripeSubscriptionId: "sub_u3",
      status: "active",
      currentPeriodEnd: recentEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u3"]);
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("active with null currentPeriodEnd → not expired", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u4"],
      stripeCustomerId: "cus_u4",
      stripeSubscriptionId: "sub_u4",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u4"]);
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("trialing with future currentPeriodEnd → not expired", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u5"],
      stripeCustomerId: "cus_u5",
      stripeSubscriptionId: "sub_u5",
      status: "trialing",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u5"]);
    expect(record?.status).toBe("trialing");
    const bufferSeconds = 3 * 24 * 60 * 60;
    const expired =
      record!.currentPeriodEnd !== null &&
      record!.currentPeriodEnd + bufferSeconds < now;
    expect(expired).toBe(false);
  });

  it("past_due status → not active regardless of period end", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u6"],
      stripeCustomerId: "cus_u6",
      stripeSubscriptionId: "sub_u6",
      status: "past_due",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u6"]);
    expect(record?.status === "active" || record?.status === "trialing").toBe(
      false,
    );
  });

  it("canceled status → not active", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["u7"],
      stripeCustomerId: "cus_u7",
      stripeSubscriptionId: "sub_u7",
      status: "canceled",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["u7"]);
    expect(record?.status === "active" || record?.status === "trialing").toBe(
      false,
    );
  });

  it("no record → not active", async () => {
    const store = makeStore();
    expect(await store.getByOrganization(ORG["nonexistent"])).toBeNull();
  });
});

describe("SubscriptionStore — cancel_at_period_end", () => {
  it("persists cancelAtPeriodEnd=true and cancelAt timestamp", async () => {
    const store = makeStore();
    const cancelTs = futureEnd;
    await store.upsert({
      giteaOrgId: ORG["v1"],
      stripeCustomerId: "cus_v1",
      stripeSubscriptionId: "sub_v1",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: true,
      cancelAt: cancelTs,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["v1"]);
    expect(record?.cancelAtPeriodEnd).toBe(true);
    expect(record?.cancelAt).toBe(cancelTs);
  });

  it("cancelAtPeriodEnd defaults to false when stored as 0", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["v2"],
      stripeCustomerId: "cus_v2",
      stripeSubscriptionId: "sub_v2",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["v2"]);
    expect(record?.cancelAtPeriodEnd).toBe(false);
    expect(record?.cancelAt).toBeNull();
  });

  it("upsert clears cancelAtPeriodEnd when subscription renews", async () => {
    const store = makeStore();
    await store.upsert({
      giteaOrgId: ORG["v3"],
      stripeCustomerId: "cus_v3",
      stripeSubscriptionId: "sub_v3",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: true,
      cancelAt: futureEnd,
      updatedAt: Date.now(),
    });
    await store.upsert({
      giteaOrgId: ORG["v3"],
      stripeCustomerId: "cus_v3",
      stripeSubscriptionId: "sub_v3",
      status: "active",
      currentPeriodEnd: futureEnd + 30 * 86400,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    const record = await store.getByOrganization(ORG["v3"]);
    expect(record?.cancelAtPeriodEnd).toBe(false);
    expect(record?.cancelAt).toBeNull();
  });
});

describe("SubscriptionStore — admin overrides", () => {
  it("persists override reason and updater metadata", async () => {
    const store = makeStore();

    await store.putAccessOverride({
      giteaOrgId: ORG["override-user"],
      access: "grant",
      reason: "manual comp",
      updatedBy: "admin-user",
      updatedAt: 123,
    });

    expect(await store.getAccessOverride(ORG["override-user"])).toEqual({
      giteaOrgId: ORG["override-user"],
      access: "grant",
      reason: "manual comp",
      updatedBy: "admin-user",
      updatedAt: 123,
    });
  });

  it("revoke overrides Stripe-backed access until the override is removed", async () => {
    const store = makeStore();

    await store.upsert({
      giteaOrgId: ORG["stripe-user"],
      stripeCustomerId: "cus_override",
      stripeSubscriptionId: "sub_override",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 100,
    });
    await store.putAccessOverride({
      giteaOrgId: ORG["stripe-user"],
      access: "revoke",
      reason: "manual review hold",
      updatedBy: "admin-user",
      updatedAt: 200,
    });

    expect(await store.resolveAccess(ORG["stripe-user"])).toEqual({
      giteaOrgId: ORG["stripe-user"],
      hasAccess: false,
      source: "admin_revoke",
      subscription: expect.objectContaining({
        status: "active",
      }),
      override: {
        giteaOrgId: ORG["stripe-user"],
        access: "revoke",
        reason: "manual review hold",
        updatedBy: "admin-user",
        updatedAt: 200,
      },
      trialEndsAt: null,
    });

    await store.deleteAccessOverride(ORG["stripe-user"]);

    expect(await store.resolveAccess(ORG["stripe-user"])).toEqual({
      giteaOrgId: ORG["stripe-user"],
      hasAccess: true,
      source: "stripe",
      subscription: expect.objectContaining({
        status: "active",
      }),
      override: null,
      trialEndsAt: null,
    });
  });

  it("lists known access states for Stripe-only and override-only users", async () => {
    const store = makeStore();

    await store.upsert({
      giteaOrgId: ORG["stripe-only"],
      stripeCustomerId: "cus_list",
      stripeSubscriptionId: "sub_list",
      status: "active",
      currentPeriodEnd: futureEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: 10,
    });
    await store.putAccessOverride({
      giteaOrgId: ORG["override-only"],
      access: "grant",
      reason: null,
      updatedBy: "admin-user",
      updatedAt: 20,
    });

    expect(await store.listKnownAccessStates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          giteaOrgId: ORG["override-only"],
          source: "admin_grant",
          hasAccess: true,
        }),
        expect.objectContaining({
          giteaOrgId: ORG["stripe-only"],
          source: "stripe",
          hasAccess: true,
        }),
      ]),
    );
  });
});

describe("resolveAccess — the ADR 0004 precedence", () => {
  const ORG_ID = 9001;

  function seedOrganization(
    organizations: OrganizationStore,
    trialEndsAt: number | null,
  ) {
    return organizations.upsert({
      giteaOrgId: ORG_ID,
      name: "mercy-health",
      createdBy: "alice",
      createdAt: now,
      trialEndsAt,
    });
  }

  it("grants access on a running local trial with no Stripe subscription at all", async () => {
    const { store, organizations, cleanup } = makeStorePair();
    try {
      await seedOrganization(organizations, futureEnd);

      const access = await store.resolveAccess(ORG_ID);
      // #369 wants no card during the trial, so there is deliberately no
      // Stripe customer to read this from.
      expect(access.hasAccess).toBe(true);
      expect(access.source).toBe("trial");
      expect(access.trialEndsAt).toBe(futureEnd);
      expect(access.subscription).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("does not grant access on an expired trial", async () => {
    const { store, organizations, cleanup } = makeStorePair();
    try {
      await seedOrganization(organizations, expiredEnd);

      const access = await store.resolveAccess(ORG_ID);
      expect(access.hasAccess).toBe(false);
      expect(access.source).toBe("none");
    } finally {
      cleanup();
    }
  });

  it("ranks Stripe above the trial, and an admin revoke above everything", async () => {
    const { store, organizations, cleanup } = makeStorePair();
    try {
      await seedOrganization(organizations, futureEnd);
      await store.upsert({
        giteaOrgId: ORG_ID,
        stripeCustomerId: "cus_trial",
        stripeSubscriptionId: "sub_trial",
        status: "active",
        currentPeriodEnd: futureEnd,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        updatedAt: Date.now(),
      });

      // Paying beats trialling: the source has to name the real authority, or
      // the billing page tells a paying customer they are on a trial.
      expect((await store.resolveAccess(ORG_ID)).source).toBe("stripe");

      await store.putAccessOverride({
        giteaOrgId: ORG_ID,
        access: "revoke",
        reason: "abuse",
        updatedBy: "admin",
        updatedAt: Date.now(),
      });

      // A revoke outranks an active subscription and a running trial alike.
      const revoked = await store.resolveAccess(ORG_ID);
      expect(revoked.hasAccess).toBe(false);
      expect(revoked.source).toBe("admin_revoke");
    } finally {
      cleanup();
    }
  });

  it("lists an organization that only has a trial", async () => {
    const { store, organizations, cleanup } = makeStorePair();
    try {
      await seedOrganization(organizations, futureEnd);

      // An org on a trial has neither a subscription row nor an override, so
      // walking only those two tables would make it invisible to an admin —
      // and "who is trialling right now" is what this list is for.
      expect(await store.listKnownAccessStates()).toEqual([
        expect.objectContaining({ giteaOrgId: ORG_ID, source: "trial" }),
      ]);
    } finally {
      cleanup();
    }
  });
});
