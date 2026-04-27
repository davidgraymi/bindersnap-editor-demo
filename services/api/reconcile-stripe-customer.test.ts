import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import Stripe from "stripe";

type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

import { runReconcileStripeCustomerCli } from "../../scripts/reconcile-stripe-customer";
import { STRIPE_API_VERSION } from "./stripe/api-version";
import { SubscriptionStore } from "./subscriptions";

type MockedStripeResponse = {
  status: number;
  body: Record<string, unknown>;
};

const originalFetch = globalThis.fetch;

let fetchCalls: string[] = [];
let stdoutChunks: string[] = [];
let stripeResponses = new Map<string, MockedStripeResponse>();
let testStore: SubscriptionStore;

beforeEach(() => {
  fetchCalls = [];
  stdoutChunks = [];
  stripeResponses = new Map();
  testStore = new SubscriptionStore(
    `/tmp/bindersnap-reconcile-test-${randomUUID()}.sqlite`,
  );

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(requestUrl);
    const key = `${url.pathname}${url.search}`;

    fetchCalls.push(key);

    const pathname = url.pathname;
    const response = stripeResponses.get(key) ?? stripeResponses.get(pathname);
    if (!response) {
      return new Response(JSON.stringify({ error: { message: "Not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockStripeResponse(
  pathWithSearch: string,
  body: Record<string, unknown>,
  status = 200,
): void {
  stripeResponses.set(pathWithSearch, { status, body });
}

function makeStripeClient(): Stripe {
  return new Stripe("sk_test_reconcile", {
    apiVersion: STRIPE_API_VERSION as StripeApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

describe("runReconcileStripeCustomerCli", () => {
  test("rebuilds a subscription row from --customer", async () => {
    const username = `customer-reconcile-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 3_600;

    mockStripeResponse(`/v1/customers/${customerId}`, {
      id: customerId,
      object: "customer",
      metadata: {
        bindersnap_username: username,
      },
    });
    mockStripeResponse(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
      {
        object: "list",
        data: [
          {
            id: subscriptionId,
            object: "subscription",
            status: "active",
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: false,
            cancel_at: null,
          },
        ],
        has_more: false,
      },
    );

    await runReconcileStripeCustomerCli(["--customer", customerId], {
      stripe: makeStripeClient(),
      store: testStore,
      writeStdout: (output) => {
        stdoutChunks.push(output);
      },
    });

    expect(
      fetchCalls.some((path) => path === `/v1/customers/${customerId}`),
    ).toBe(true);
    expect(
      fetchCalls.some((path) =>
        path.startsWith(
          `/v1/subscriptions?customer=${encodeURIComponent(customerId)}`,
        ),
      ),
    ).toBe(true);
    expect(testStore.getByUsername(username)).toEqual({
      username,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: "active",
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: expect.any(Number),
    });
    expect(stdoutChunks.join("")).toContain(`"username": "${username}"`);
  });

  test("rebuilds a subscription row from --username", async () => {
    const username = `username-reconcile-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 1_800;
    mockStripeResponse("/v1/customers/search", {
      object: "search_result",
      data: [
        {
          id: customerId,
          object: "customer",
          metadata: {
            bindersnap_username: username,
          },
        },
      ],
      has_more: false,
    });
    mockStripeResponse(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
      {
        object: "list",
        data: [
          {
            id: subscriptionId,
            object: "subscription",
            status: "trialing",
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: true,
            cancel_at: currentPeriodEnd + 600,
          },
        ],
        has_more: false,
      },
    );

    await runReconcileStripeCustomerCli(["--username", username], {
      stripe: makeStripeClient(),
      store: testStore,
      writeStdout: (output) => {
        stdoutChunks.push(output);
      },
    });

    const searchCall = fetchCalls.find((path) =>
      path.startsWith("/v1/customers/search"),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain(username);
    expect(
      fetchCalls.some((path) =>
        path.startsWith(
          `/v1/subscriptions?customer=${encodeURIComponent(customerId)}`,
        ),
      ),
    ).toBe(true);
    expect(testStore.getByUsername(username)).toEqual({
      username,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: "trialing",
      currentPeriodEnd,
      cancelAtPeriodEnd: true,
      cancelAt: currentPeriodEnd + 600,
      updatedAt: expect.any(Number),
    });
    expect(stdoutChunks.join("")).toContain(
      `"stripeCustomerId": "${customerId}"`,
    );
  });
});
