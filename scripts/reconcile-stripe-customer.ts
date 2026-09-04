#!/usr/bin/env bun

import type Stripe from "stripe";

import { getStripeClient } from "../services/api/stripe/client";
import {
  reconcileStripeCustomerByCustomerId,
  reconcileStripeCustomerByOrganization,
} from "../services/api/stripe/reconcile";
import { subscriptionStore } from "../services/api/subscriptions";

type ReconcileArgs = {
  /** Gitea org id. Billing keys to the organization (ADR 0004). */
  giteaOrgId: number | null;
  customerId: string | null;
};

type ReconcileStripeCustomerStore = Pick<typeof subscriptionStore, "upsert">;

type RunReconcileStripeCustomerCliOptions = {
  stripe?: Stripe;
  store?: ReconcileStripeCustomerStore;
  writeStdout?: (output: string) => void;
};

function parseArgs(argv: string[]): ReconcileArgs {
  let giteaOrgId: number | null = null;
  let customerId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--org") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --org.");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error("--org takes a Gitea organization id.");
      }
      giteaOrgId = parsed;
      index += 1;
      continue;
    }

    if (arg === "--customer") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --customer.");
      }
      customerId = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if ((giteaOrgId ? 1 : 0) + (customerId ? 1 : 0) !== 1) {
    throw new Error(
      "Pass exactly one of --org <gitea org id> or --customer <value>.",
    );
  }

  return { giteaOrgId, customerId };
}

export async function runReconcileStripeCustomerCli(
  argv = process.argv.slice(2),
  options: RunReconcileStripeCustomerCliOptions = {},
): Promise<void> {
  const stripe = options.stripe ?? getStripeClient();

  const args = parseArgs(argv);
  const result = args.giteaOrgId
    ? await reconcileStripeCustomerByOrganization(stripe, args.giteaOrgId)
    : await reconcileStripeCustomerByCustomerId(stripe, args.customerId!);

  if (!result) {
    throw new Error(
      "Unable to rebuild the subscription row from Stripe. Check that the customer exists, has metadata.bindersnap_gitea_org_id, and has at least one subscription.",
    );
  }

  const store = options.store ?? subscriptionStore;
  await store.upsert(result.record);

  const writeStdout =
    options.writeStdout ?? ((output: string) => process.stdout.write(output));
  writeStdout(
    JSON.stringify(
      {
        ok: true,
        giteaOrgId: result.record.giteaOrgId,
        stripeCustomerId: result.record.stripeCustomerId,
        stripeSubscriptionId: result.record.stripeSubscriptionId,
        status: result.record.status,
        currentPeriodEnd: result.record.currentPeriodEnd,
        cancelAtPeriodEnd: result.record.cancelAtPeriodEnd,
        cancelAt: result.record.cancelAt,
      },
      null,
      2,
    ) + "\n",
  );
}

if (import.meta.main) {
  runReconcileStripeCustomerCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
