#!/usr/bin/env bun

import { config } from "../services/api/config";
import { STRIPE_API_VERSION } from "../services/api/stripe/api-version";
import {
  reconcileStripeCustomerByCustomerId,
  reconcileStripeCustomerByUsername,
  type StripeFetch,
} from "../services/api/stripe/reconcile";
import { subscriptionStore } from "../services/api/subscriptions";

type ReconcileArgs = {
  username: string | null;
  customerId: string | null;
};

type ReconcileStripeCustomerStore = Pick<typeof subscriptionStore, "upsert">;

type RunReconcileStripeCustomerCliOptions = {
  stripeFetch?: StripeFetch;
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

async function defaultStripeFetch(
  path: string,
  body?: URLSearchParams,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetch(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...extraHeaders,
    },
    body,
  });
}

export async function runReconcileStripeCustomerCli(
  argv = process.argv.slice(2),
  options: RunReconcileStripeCustomerCliOptions = {},
): Promise<void> {
  const stripeFetch = options.stripeFetch ?? defaultStripeFetch;
  if (!options.stripeFetch && !config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }

  const args = parseArgs(argv);
  const result = args.username
    ? await reconcileStripeCustomerByUsername(stripeFetch, args.username)
    : await reconcileStripeCustomerByCustomerId(stripeFetch, args.customerId!);

  if (!result) {
    throw new Error(
      "Unable to rebuild the subscription row from Stripe. Check that the customer exists, has metadata.bindersnap_username, and has at least one subscription.",
    );
  }

  const store = options.store ?? subscriptionStore;
  store.upsert(result.record);

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
