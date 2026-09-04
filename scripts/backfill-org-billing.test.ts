import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GiteaClient } from "../services/api/gitea-client/client";
import { OrganizationStore } from "../services/api/organizations";
import { SubscriptionStore } from "../services/api/subscriptions";
import { formatReport, parseArgs, runBackfill } from "./backfill-org-billing";

/**
 * The re-key is where a paying customer's subscription could go missing, so
 * these lean on the two properties that make that impossible: legacy rows are
 * never touched, and a username that cannot be mapped is reported rather than
 * guessed at.
 */

function makeTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-backfill-"));
  return {
    path: join(dir, "sessions.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** A database that has run the re-key with legacy rows parked in it. */
function seedMigratedDatabase(path: string) {
  const legacy = new Database(path);
  legacy.exec(`
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
      ('alice', 'cus_alice', 'sub_alice', 'active', 99999999, 0, NULL, 100),
      ('nomad', 'cus_nomad', 'sub_nomad', 'active', 99999999, 0, NULL, 110);
    INSERT INTO subscription_access_overrides VALUES
      ('bob', 'grant', 'design partner', 'admin-user', 200);
  `);
  legacy.close();

  // Opening the store applies 0002, which parks those rows.
  const store = new SubscriptionStore(path, new OrganizationStore(path));
  return store;
}

/** Gitea, answering "which organization is this person in?". */
function createGitea(orgsByUser: Record<string, { id: number; name: string }>) {
  const get = mock(async (_path: string, init: any) => {
    const username = init?.params?.path?.username as string;
    const organization = orgsByUser[username];
    return {
      data: organization
        ? [{ id: organization.id, username: organization.name }]
        : [],
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET: get, use: mock() } as unknown as GiteaClient;
}

describe("parseArgs", () => {
  test("reads the two flags and rejects anything else", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, skipStripe: false });
    expect(parseArgs(["--dry", "--skip-stripe"])).toEqual({
      dryRun: true,
      skipStripe: true,
    });
    expect(() => parseArgs(["--yolo"])).toThrow(/Unknown argument/);
  });
});

describe("runBackfill", () => {
  test("maps every legacy row onto its organization", async () => {
    const temp = makeTempDb();
    try {
      const store = seedMigratedDatabase(temp.path);
      const client = createGitea({
        alice: { id: 501, name: "mercy-health" },
        bob: { id: 501, name: "mercy-health" },
        nomad: { id: 502, name: "st-jude" },
      });

      const report = await runBackfill(
        { dryRun: false, skipStripe: true },
        { client, store, dbPath: temp.path, stripe: null },
      );

      expect(report.unmapped).toEqual([]);
      expect(report.mapped).toHaveLength(3);

      expect(await store.getByOrganization(501)).toMatchObject({
        stripeCustomerId: "cus_alice",
        stripeSubscriptionId: "sub_alice",
        status: "active",
        updatedAt: 100,
      });
      expect(await store.getByOrganization(502)).toMatchObject({
        stripeCustomerId: "cus_nomad",
      });
      // The override followed the person to their organization, reason and
      // attribution intact.
      expect(await store.getAccessOverride(501)).toEqual({
        giteaOrgId: 501,
        access: "grant",
        reason: "design partner",
        updatedBy: "admin-user",
        updatedAt: 200,
      });
    } finally {
      temp.cleanup();
    }
  });

  test("reports an unmappable username instead of guessing", async () => {
    const temp = makeTempDb();
    try {
      const store = seedMigratedDatabase(temp.path);
      const client = createGitea({ alice: { id: 501, name: "mercy-health" } });

      const report = await runBackfill(
        { dryRun: false, skipStripe: true },
        { client, store, dbPath: temp.path, stripe: null },
      );

      expect(report.unmapped.map((row) => row.username).sort()).toEqual([
        "bob",
        "nomad",
      ]);

      // And the rows they came from are still sitting in the legacy tables,
      // so re-running after fixing the accounts picks them up.
      const db = new Database(temp.path, { readonly: true });
      const parked = db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) as count FROM legacy_username_subscriptions",
        )
        .get();
      db.close();
      expect(parked?.count).toBe(2);

      expect(formatReport(report)).toContain("no organization found");
    } finally {
      temp.cleanup();
    }
  });

  test("a dry run writes nothing", async () => {
    const temp = makeTempDb();
    try {
      const store = seedMigratedDatabase(temp.path);
      const client = createGitea({ alice: { id: 501, name: "mercy-health" } });

      const report = await runBackfill(
        { dryRun: true, skipStripe: true },
        { client, store, dbPath: temp.path, stripe: null },
      );

      expect(report.mapped).toHaveLength(1);
      expect(await store.getByOrganization(501)).toBeNull();
      expect(formatReport(report)).toContain("Dry run");
    } finally {
      temp.cleanup();
    }
  });

  test("stamps the organization onto the Stripe customer", async () => {
    const temp = makeTempDb();
    try {
      const store = seedMigratedDatabase(temp.path);
      const client = createGitea({ alice: { id: 501, name: "mercy-health" } });
      const update = mock(
        async (_customerId: string, _params: { metadata: unknown }) => ({}),
      );
      const stripe = { customers: { update } } as never;

      const report = await runBackfill(
        { dryRun: false, skipStripe: false },
        { client, store, dbPath: temp.path, stripe },
      );

      // Later subscription webhooks carry only a customer id, so without this
      // stamp they cannot find the organization to update.
      expect(report.stripeCustomersStamped).toEqual(["cus_alice"]);
      expect(update.mock.calls[0]).toEqual([
        "cus_alice",
        {
          metadata: {
            bindersnap_gitea_org_id: "501",
            bindersnap_organization: "mercy-health",
            bindersnap_username: "alice",
          },
        },
      ]);
    } finally {
      temp.cleanup();
    }
  });

  test("re-running is safe", async () => {
    const temp = makeTempDb();
    try {
      const store = seedMigratedDatabase(temp.path);
      const client = createGitea({
        alice: { id: 501, name: "mercy-health" },
        bob: { id: 501, name: "mercy-health" },
        nomad: { id: 502, name: "st-jude" },
      });
      const deps = {
        client,
        store,
        dbPath: temp.path,
        stripe: null,
      };

      await runBackfill({ dryRun: false, skipStripe: true }, deps);
      const second = await runBackfill(
        { dryRun: false, skipStripe: true },
        deps,
      );

      // Every write is an upsert on the org id, so the repair path is simply
      // "run it again" rather than "restore a backup first".
      expect(second.unmapped).toEqual([]);
      expect(await store.getByOrganization(501)).toMatchObject({
        stripeCustomerId: "cus_alice",
      });
    } finally {
      temp.cleanup();
    }
  });
});
