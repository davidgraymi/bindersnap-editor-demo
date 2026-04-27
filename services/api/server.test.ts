import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";
import { SubscriptionStore, subscriptionStore } from "./subscriptions";

type MockedFetchCall = {
  path: string;
  idempotencyKey: string | null;
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalStripeSecretKey = config.stripeSecretKey;
const originalStripePriceId = config.stripePriceId;
const originalSessionsDbPath = config.sessionsDbPath;

let fetchCalls: MockedFetchCall[] = [];

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_bindersnap";
  config.stripePriceId = "price_test_bindersnap";
  config.sessionsDbPath = `/tmp/bindersnap-server-test-${randomUUID()}.sqlite`;

  (sessionStore as { _store: SessionStore | null })._store = new SessionStore(
    config.sessionsDbPath,
  );
  (subscriptionStore as { _store: SubscriptionStore | null })._store =
    new SubscriptionStore(config.sessionsDbPath);

  fetchCalls = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    fetchCalls.push({
      path: url.pathname,
      idempotencyKey: new Headers(init?.headers).get("Idempotency-Key") ?? null,
    });

    const responseUrl = url.pathname.includes("billing_portal")
      ? "https://billing.stripe.com/p/session/test_123"
      : "https://checkout.stripe.com/c/pay/test_123";

    return new Response(JSON.stringify({ url: responseUrl }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.apiPort = originalApiPort;
  config.stripeSecretKey = originalStripeSecretKey;
  config.stripePriceId = originalStripePriceId;
  config.sessionsDbPath = originalSessionsDbPath;
});

function seedSession(username: string): string {
  const sessionId = `sess_${randomUUID()}`;
  sessionStore.put({
    id: sessionId,
    username,
    giteaToken: "gitea_token_test",
    giteaTokenName: "bindersnap-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  return sessionId;
}

function makeBillingRequest(pathname: string, sessionId: string): Request {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
    },
  });
}

describe("billing Stripe idempotency", () => {
  test("checkout sends a unique Stripe Idempotency-Key per attempt", async () => {
    const server = createApiServer();
    const username = `checkout-${randomUUID()}`;
    const sessionId = seedSession(username);

    try {
      const first = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId),
      );
      const second = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0]?.path).toBe("/v1/checkout/sessions");
      expect(fetchCalls[1]?.path).toBe("/v1/checkout/sessions");
      expect(fetchCalls[0]?.idempotencyKey).toMatch(
        /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(fetchCalls[1]?.idempotencyKey).toMatch(
        /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(fetchCalls[0]?.idempotencyKey).not.toBe(
        fetchCalls[1]?.idempotencyKey,
      );
    } finally {
      server.stop(true);
    }
  });

  test("portal sends a unique Stripe Idempotency-Key per attempt", async () => {
    const server = createApiServer();
    const username = `portal-${randomUUID()}`;
    const sessionId = seedSession(username);

    subscriptionStore.upsert({
      username,
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_123",
      status: "active",
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 60_000,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    try {
      const first = await server.fetch(
        makeBillingRequest("/api/app/billing/portal", sessionId),
      );
      const second = await server.fetch(
        makeBillingRequest("/api/app/billing/portal", sessionId),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0]?.path).toBe("/v1/billing_portal/sessions");
      expect(fetchCalls[1]?.path).toBe("/v1/billing_portal/sessions");
      expect(fetchCalls[0]?.idempotencyKey).toMatch(
        /^portal-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(fetchCalls[1]?.idempotencyKey).toMatch(
        /^portal-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(fetchCalls[0]?.idempotencyKey).not.toBe(
        fetchCalls[1]?.idempotencyKey,
      );
    } finally {
      server.stop(true);
    }
  });
});
