#!/usr/bin/env bun

import type Stripe from "stripe";

import { openSqliteDb } from "../services/api/db/client";
import {
  legacyUsernameSubscriptionAccessOverrides,
  legacyUsernameSubscriptions,
} from "../services/api/db/schema";
import { config } from "../services/api/config";
import type { GiteaClient } from "../services/api/gitea-client/client";
import { createPrivilegedGiteaClient } from "../services/api/privileged-client";
import { resolveOrganizationForUser } from "../services/api/session-organization";
import { getStripeClient } from "../services/api/stripe/client";
import {
  subscriptionStore,
  type SubscriptionBackend,
} from "../services/api/subscriptions";

/**
 * ADR 0004, migration step 4: re-key billing.
 *
 * The `0002_bill_the_organization` migration parked every username-keyed row in
 * a legacy table, because mapping a username to an organization needs Gitea and
 * SQL cannot reach it. This is that mapping.
 *
 * It is deliberately boring and repeatable:
 *
 *   - It never deletes a legacy row. Dropping those tables is a separate,
 *     later, deliberate act, once the mapping has been eyeballed.
 *   - It reports every username it could not map instead of guessing.
 *   - Re-running it is safe: each write is an upsert keyed on the org id.
 *   - `--dry` prints exactly what it would do and writes nothing.
 *
 * It also stamps `bindersnap_gitea_org_id` onto the matching Stripe customer,
 * because that is what later subscription webhooks reconcile from. Pass
 * `--skip-stripe` to do only the local half.
 */

export interface BackfillOptions {
  dryRun: boolean;
  skipStripe: boolean;
}

export interface BackfillRow {
  username: string;
  giteaOrgId: number | null;
  organizationName: string | null;
  stripeCustomerId?: string;
  kind: "subscription" | "override";
}

export interface BackfillReport {
  mapped: BackfillRow[];
  unmapped: BackfillRow[];
  stripeCustomersStamped: string[];
  dryRun: boolean;
}

export function parseArgs(argv: string[]): BackfillOptions {
  let dryRun = false;
  let skipStripe = false;

  for (const arg of argv) {
    if (arg === "--dry" || arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--skip-stripe") {
      skipStripe = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, skipStripe };
}

export function formatReport(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? "Dry run — nothing was written."
      : "Backfill complete. Legacy tables are untouched; drop them by hand once you have checked this.",
  );
  lines.push(`Mapped: ${report.mapped.length}`);
  for (const row of report.mapped) {
    lines.push(
      `  ${row.kind.padEnd(12)} ${row.username} → ${row.organizationName} (${row.giteaOrgId})`,
    );
  }
  lines.push(`Unmapped: ${report.unmapped.length}`);
  for (const row of report.unmapped) {
    lines.push(
      `  ${row.kind.padEnd(12)} ${row.username} — no organization found`,
    );
  }
  if (report.stripeCustomersStamped.length > 0) {
    lines.push(
      `Stripe customers stamped: ${report.stripeCustomersStamped.length}`,
    );
    for (const customerId of report.stripeCustomersStamped) {
      lines.push(`  ${customerId}`);
    }
  }
  if (report.unmapped.length > 0) {
    lines.push(
      "",
      "Every unmapped row still exists in its legacy table. Give those accounts an organization (re-run signup provisioning) and run this again.",
    );
  }
  return lines.join("\n") + "\n";
}

export interface RunBackfillDependencies {
  client: GiteaClient;
  store?: SubscriptionBackend;
  dbPath?: string;
  stripe?: Stripe | null;
}

export async function runBackfill(
  options: BackfillOptions,
  deps: RunBackfillDependencies,
): Promise<BackfillReport> {
  const db = openSqliteDb(deps.dbPath ?? config.sessionsDbPath);
  const store = deps.store ?? subscriptionStore;

  const legacySubscriptions = db
    .select()
    .from(legacyUsernameSubscriptions)
    .all();
  const legacyOverrides = db
    .select()
    .from(legacyUsernameSubscriptionAccessOverrides)
    .all();

  const report: BackfillReport = {
    mapped: [],
    unmapped: [],
    stripeCustomersStamped: [],
    dryRun: options.dryRun,
  };

  // One lookup per distinct username, however many rows they own.
  const organizations = new Map<string, { id: number; name: string } | null>();
  const resolve = async (username: string) => {
    if (!organizations.has(username)) {
      organizations.set(
        username,
        await resolveOrganizationForUser(deps.client, username),
      );
    }
    return organizations.get(username) ?? null;
  };

  for (const row of legacySubscriptions) {
    const organization = await resolve(row.username);
    const entry: BackfillRow = {
      username: row.username,
      giteaOrgId: organization?.id ?? null,
      organizationName: organization?.name ?? null,
      stripeCustomerId: row.stripeCustomerId,
      kind: "subscription",
    };

    if (!organization) {
      report.unmapped.push(entry);
      continue;
    }

    report.mapped.push(entry);
    if (options.dryRun) continue;

    await store.upsert({
      giteaOrgId: organization.id,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelAt: row.cancelAt,
      updatedAt: row.updatedAt,
    });

    if (!options.skipStripe && deps.stripe) {
      await deps.stripe.customers.update(row.stripeCustomerId, {
        metadata: {
          bindersnap_gitea_org_id: String(organization.id),
          bindersnap_organization: organization.name,
          bindersnap_username: row.username,
        },
      });
      report.stripeCustomersStamped.push(row.stripeCustomerId);
    }
  }

  for (const row of legacyOverrides) {
    const organization = await resolve(row.username);
    const entry: BackfillRow = {
      username: row.username,
      giteaOrgId: organization?.id ?? null,
      organizationName: organization?.name ?? null,
      kind: "override",
    };

    if (!organization) {
      report.unmapped.push(entry);
      continue;
    }

    report.mapped.push(entry);
    if (options.dryRun) continue;

    await store.putAccessOverride({
      giteaOrgId: organization.id,
      access: row.access,
      reason: row.reason,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    });
  }

  return report;
}

export async function runBackfillCli(
  argv = process.argv.slice(2),
  writeStdout: (output: string) => void = (output) =>
    process.stdout.write(output),
): Promise<void> {
  const options = parseArgs(argv);

  const client = createPrivilegedGiteaClient();
  if (!client) {
    throw new Error(
      "No privileged Gitea client. Set BINDERSNAP_GITEA_SERVICE_TOKEN (or the admin credentials outside production).",
    );
  }

  const stripe =
    options.skipStripe || !config.stripeSecretKey ? null : getStripeClient();

  const report = await runBackfill(options, { client, stripe });
  writeStdout(formatReport(report));
}

if (import.meta.main) {
  runBackfillCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
