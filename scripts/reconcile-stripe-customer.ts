#!/usr/bin/env bun

import type Stripe from "stripe";

import { getStripeClient } from "../services/api/stripe/client";
import {
  reconcileStripeCustomerByCustomerId,
  reconcileStripeCustomerByUsername,
} from "../services/api/stripe/reconcile";
import { subscriptionStore } from "../services/api/subscriptions";

type ReconcileArgs = {
  username: string | null;
  customerId: string | null;
};

type ReconcileStripeCustomerStore = Pick<typeof subscriptionStore, "upsert">;

type RunReconcileStripeCustomerCliOptions = {
  stripe?: Stripe;
  store?: ReconcileStripeCustomerStore;
  writeStdout?: (output: string) => void;
};

function parseArgs(argv: string[]): ReconcileArgs {
  let username: string | null = null;
  let customerId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--username") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("Missing value for --username.");
      }
      username = value;
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

  if ((username ? 1 : 0) + (customerId ? 1 : 0) !== 1) {
    throw new Error(
      "Pass exactly one of --username <value> or --customer <value>.",
    );
  }

  return { username, customerId };
}

export async function runReconcileStripeCustomerCli(
  argv = process.argv.slice(2),
  options: RunReconcileStripeCustomerCliOptions = {},
): Promise<void> {
  const stripe = options.stripe ?? getStripeClient();

  const args = parseArgs(argv);
  const result = args.username
    ? await reconcileStripeCustomerByUsername(stripe, args.username)
    : await reconcileStripeCustomerByCustomerId(stripe, args.customerId!);

  if (!result) {
    throw new Error(
      "Unable to rebuild the subscription row from Stripe. Check that the customer exists, has metadata.bindersnap_username, and has at least one subscription.",
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
        username: result.record.username,
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
