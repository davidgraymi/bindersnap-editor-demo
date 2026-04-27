import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { runReconcileStripeCustomerCli } from "../../scripts/reconcile-stripe-customer";
import { SubscriptionStore } from "./subscriptions";

type MockedStripeResponse = {
  status: number;
  body: Record<string, unknown>;
};

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
});

afterEach(() => {});

function mockStripeResponse(
  pathWithSearch: string,
  body: Record<string, unknown>,
  status = 200,
): void {
  stripeResponses.set(pathWithSearch, { status, body });
}

async function stripeFetch(input: string | URL | Request): Promise<Response> {
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const key = requestUrl.startsWith("http")
    ? (() => {
        const url = new URL(requestUrl);
        return `${url.pathname}${url.search}`;
      })()
    : requestUrl;

  fetchCalls.push(key);

  const pathname = key.split("?")[0] ?? key;
  const response = stripeResponses.get(key) ?? stripeResponses.get(pathname);
  if (!response) {
    return new Response(JSON.stringify({ error: { message: "Not found" } }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: {
      "Content-Type": "application/json",
    },
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
      metadata: {
        bindersnap_username: username,
      },
    });
    mockStripeResponse(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
      {
        data: [
          {
            id: subscriptionId,
            status: "active",
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: false,
            cancel_at: null,
          },
        ],
      },
    );

    await runReconcileStripeCustomerCli(["--customer", customerId], {
      stripeFetch,
      store: testStore,
      writeStdout: (output) => {
        stdoutChunks.push(output);
      },
    });

    expect(fetchCalls).toEqual([
      `/v1/customers/${customerId}`,
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
    ]);
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
      data: [
        {
          id: customerId,
          metadata: {
            bindersnap_username: username,
          },
        },
      ],
    });
    mockStripeResponse(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
      {
        data: [
          {
            id: subscriptionId,
            status: "trialing",
            current_period_end: currentPeriodEnd,
            cancel_at_period_end: true,
            cancel_at: currentPeriodEnd + 600,
          },
        ],
      },
    );

    await runReconcileStripeCustomerCli(["--username", username], {
      stripeFetch,
      store: testStore,
      writeStdout: (output) => {
        stdoutChunks.push(output);
      },
    });

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]).toContain("/v1/customers/search?query=");
    expect(fetchCalls[0]).toContain(username);
    expect(fetchCalls[1]).toBe(
      `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`,
    );
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
