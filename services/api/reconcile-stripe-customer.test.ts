import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import Stripe from "stripe";

type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

import { runReconcileStripeCustomerCli } from "../../scripts/reconcile-stripe-customer";
import { STRIPE_API_VERSION } from "./stripe/api-version";
import { OrganizationStore } from "./organizations";
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
  const testDbPath = `/tmp/bindersnap-reconcile-test-${randomUUID()}.sqlite`;
  testStore = new SubscriptionStore(
    testDbPath,
    new OrganizationStore(testDbPath),
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
    const giteaOrgId = 7101;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 3_600;

    mockStripeResponse(`/v1/customers/${customerId}`, {
      id: customerId,
      object: "customer",
      metadata: {
        bindersnap_gitea_org_id: String(giteaOrgId),
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
    expect(await testStore.getByOrganization(giteaOrgId)).toEqual({
      giteaOrgId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: "active",
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: expect.any(Number),
    });
    expect(stdoutChunks.join("")).toContain(`"giteaOrgId": ${giteaOrgId}`);
  });

  test("rebuilds a subscription row from --org", async () => {
    const giteaOrgId = 7102;
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
            bindersnap_gitea_org_id: String(giteaOrgId),
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

    await runReconcileStripeCustomerCli(["--org", String(giteaOrgId)], {
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
    // The search is by organization: a customer is bound to the org, never to
    // whichever human happened to click Subscribe.
    expect(searchCall).toContain("bindersnap_gitea_org_id");
    expect(
      fetchCalls.some((path) =>
        path.startsWith(
          `/v1/subscriptions?customer=${encodeURIComponent(customerId)}`,
        ),
      ),
    ).toBe(true);
    expect(await testStore.getByOrganization(giteaOrgId)).toEqual({
      giteaOrgId,
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
