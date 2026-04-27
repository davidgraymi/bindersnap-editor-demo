import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";
import { SubscriptionStore, subscriptionStore } from "./subscriptions";

type MockedFetchCall = {
  path: string;
  method: string;
  idempotencyKey: string | null;
  body: string | null;
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalStripeSecretKey = config.stripeSecretKey;
const originalStripePriceId = config.stripePriceId;
const originalSessionsDbPath = config.sessionsDbPath;

let fetchCalls: MockedFetchCall[] = [];
let userEmailsByToken = new Map<string, string>();

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
  userEmailsByToken = new Map();
  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(requestUrl);
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : null;

    fetchCalls.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      idempotencyKey: headers.get("Idempotency-Key") ?? null,
      body,
    });

    if (url.pathname === "/api/v1/user") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ")
        ? authHeader.slice("token ".length)
        : "";
      const email = userEmailsByToken.get(token);

      if (!email) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(JSON.stringify({ email }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

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

function seedSession(
  username: string,
  options?: {
    email?: string;
  },
): string {
  const sessionId = `sess_${randomUUID()}`;
  const giteaToken = `gitea_token_${randomUUID()}`;
  const email =
    options?.email ?? `${username.toLowerCase()}@${config.emailDomain}`;

  userEmailsByToken.set(giteaToken, email);
  sessionStore.put({
    id: sessionId,
    username,
    giteaToken,
    giteaTokenName: "bindersnap-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  return sessionId;
}

function getFetchCallsByPath(path: string): MockedFetchCall[] {
  return fetchCalls.filter((call) => call.path === path);
}

function getPostedFormBody(call: MockedFetchCall): URLSearchParams {
  return new URLSearchParams(call.body ?? "");
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
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(2);
      expect(checkoutCalls[0]?.idempotencyKey).toMatch(
        /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(checkoutCalls[1]?.idempotencyKey).toMatch(
        /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(checkoutCalls[0]?.idempotencyKey).not.toBe(
        checkoutCalls[1]?.idempotencyKey,
      );
    } finally {
      server.stop(true);
    }
  });

  test("checkout includes customer_email and bindersnap username metadata when no subscription exists", async () => {
    const server = createApiServer();
    const username = `checkout-metadata-${randomUUID()}`;
    const email = `${username}@${config.emailDomain}`;
    const sessionId = seedSession(username, { email });

    try {
      const response = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId),
      );

      expect(response.status).toBe(200);
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(1);

      const form = getPostedFormBody(checkoutCalls[0]!);
      expect(form.get("customer_email")).toBe(email);
      expect(form.get("metadata[bindersnap_username]")).toBe(username);
      expect(form.get("customer")).toBeNull();
    } finally {
      server.stop(true);
    }
  });

  test("checkout reuses an existing stripe customer id when a subscription row exists", async () => {
    const server = createApiServer();
    const username = `checkout-customer-${randomUUID()}`;
    const email = `${username}@${config.emailDomain}`;
    const existingCustomerId = "cus_existing_123";
    const sessionId = seedSession(username, { email });

    subscriptionStore.upsert({
      username,
      stripeCustomerId: existingCustomerId,
      stripeSubscriptionId: "sub_existing_123",
      status: "incomplete",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    try {
      const response = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId),
      );

      expect(response.status).toBe(200);
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(1);

      const form = getPostedFormBody(checkoutCalls[0]!);
      expect(form.get("customer")).toBe(existingCustomerId);
      expect(form.get("customer_email")).toBeNull();
      expect(form.get("metadata[bindersnap_username]")).toBe(username);
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
      const portalCalls = getFetchCallsByPath("/v1/billing_portal/sessions");
      expect(portalCalls).toHaveLength(2);
      expect(portalCalls[0]?.idempotencyKey).toMatch(
        /^portal-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(portalCalls[1]?.idempotencyKey).toMatch(
        /^portal-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(portalCalls[0]?.idempotencyKey).not.toBe(
        portalCalls[1]?.idempotencyKey,
      );
    } finally {
      server.stop(true);
    }
  });
});
