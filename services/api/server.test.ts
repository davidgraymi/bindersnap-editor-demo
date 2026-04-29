import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { createApiServer } from "./server";
import { SessionStore, sessionStore } from "./sessions";
import { resetStripeClientForTests } from "./stripe/client";
import {
  SubscriptionStore,
  subscriptionStore,
  WebhookEventStore,
  webhookEventStore,
} from "./subscriptions";

type MockedFetchCall = {
  path: string;
  method: string;
  idempotencyKey: string | null;
  body: string | null;
};

type MockedStripeResource = {
  status: number;
  body: Record<string, unknown>;
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalStripeSecretKey = config.stripeSecretKey;
const originalStripeWebhookSecret = config.stripeWebhookSecret;
const originalStripePriceId = config.stripePriceId;
const originalSessionsDbPath = config.sessionsDbPath;

let fetchCalls: MockedFetchCall[] = [];
let userEmailsByToken = new Map<string, string>();
let stripeSubscriptionsById = new Map<string, MockedStripeResource>();
let stripeCustomersById = new Map<string, MockedStripeResource>();

beforeEach(() => {
  config.apiPort = 0;
  config.stripeSecretKey = "sk_test_bindersnap";
  config.stripeWebhookSecret = "whsec_test_bindersnap";
  config.stripePriceId = "price_test_bindersnap";
  config.sessionsDbPath = `/tmp/bindersnap-server-test-${randomUUID()}.sqlite`;
  resetStripeClientForTests();

  (sessionStore as { _store: SessionStore | null })._store = new SessionStore(
    config.sessionsDbPath,
  );
  (subscriptionStore as { _store: SubscriptionStore | null })._store =
    new SubscriptionStore(config.sessionsDbPath);
  (webhookEventStore as { _store: WebhookEventStore | null })._store =
    new WebhookEventStore(config.sessionsDbPath);

  fetchCalls = [];
  userEmailsByToken = new Map();
  stripeSubscriptionsById = new Map();
  stripeCustomersById = new Map();
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

    if (url.pathname.startsWith("/v1/subscriptions/")) {
      const subscriptionId = url.pathname.slice("/v1/subscriptions/".length);
      const subscription = stripeSubscriptionsById.get(subscriptionId);

      if (!subscription) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(JSON.stringify(subscription.body), {
        status: subscription.status,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url.pathname.startsWith("/v1/customers/")) {
      const customerId = url.pathname.slice("/v1/customers/".length);
      const customer = stripeCustomersById.get(customerId);

      if (!customer) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      // Handle customer updates (POST = update in Stripe SDK)
      if (init?.method === "POST" && body) {
        const updateParams = new URLSearchParams(body);
        const updatedMetadata: Record<string, string> = {
          ...((customer.body.metadata ?? {}) as Record<string, string>),
        };
        // Parse metadata updates
        for (const [key, value] of updateParams.entries()) {
          if (key.startsWith("metadata[") && key.endsWith("]")) {
            const metaKey = key.slice("metadata[".length, -1);
            updatedMetadata[metaKey] = value;
          }
        }
        customer.body.metadata = updatedMetadata;
      }

      return new Response(JSON.stringify(customer.body), {
        status: customer.status,
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
  config.stripeWebhookSecret = originalStripeWebhookSecret;
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

function mockStripeSubscription(
  id: string,
  body: Record<string, unknown>,
  status = 200,
): void {
  stripeSubscriptionsById.set(id, { status, body });
}

function mockStripeCustomer(
  id: string,
  body: Record<string, unknown>,
  status = 200,
): void {
  stripeCustomersById.set(id, { status, body });
}

function makeBillingRequest(
  pathname: string,
  sessionId: string,
  body?: Record<string, unknown>,
): Request {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      Origin: config.appOrigin,
      Cookie: `${config.sessionCookieName}=${sessionId}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function signStripeWebhookBody(
  body: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${body}`),
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function makeStripeWebhookRequest(
  event: Record<string, unknown>,
  options?: {
    url?: string;
    headers?: HeadersInit;
  },
): Promise<Request> {
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signStripeWebhookBody(
    rawBody,
    config.stripeWebhookSecret,
    timestamp,
  );

  return new Request(options?.url ?? "http://localhost/stripe/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
      ...options?.headers,
    },
    body: rawBody,
  });
}

describe("billing Stripe idempotency", () => {
  test("checkout sends a unique Stripe Idempotency-Key per attempt when no client key provided", async () => {
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

  test("checkout uses client-supplied idempotency key when valid", async () => {
    const server = createApiServer();
    const username = `checkout-client-key-${randomUUID()}`;
    const sessionId = seedSession(username);
    const clientKey = randomUUID();

    try {
      const first = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId, {
          idempotencyKey: clientKey,
        }),
      );
      const second = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId, {
          idempotencyKey: clientKey,
        }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(2);
      expect(checkoutCalls[0]?.idempotencyKey).toBe(`checkout-${clientKey}`);
      expect(checkoutCalls[1]?.idempotencyKey).toBe(`checkout-${clientKey}`);
    } finally {
      server.stop(true);
    }
  });

  test("checkout falls back to server-generated key when client key is invalid", async () => {
    const server = createApiServer();
    const username = `checkout-invalid-key-${randomUUID()}`;
    const sessionId = seedSession(username);

    try {
      const response = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId, {
          idempotencyKey: "invalid!@#$",
        }),
      );

      expect(response.status).toBe(200);
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(1);
      // Should use server-generated UUID, not the invalid client key
      expect(checkoutCalls[0]?.idempotencyKey).toMatch(
        /^checkout-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(checkoutCalls[0]?.idempotencyKey).not.toContain("invalid");
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

  test("portal sends a unique Stripe Idempotency-Key per attempt when no client key provided", async () => {
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

  test("portal uses client-supplied idempotency key when valid", async () => {
    const server = createApiServer();
    const username = `portal-client-key-${randomUUID()}`;
    const sessionId = seedSession(username);
    const clientKey = randomUUID();

    subscriptionStore.upsert({
      username,
      stripeCustomerId: "cus_test_456",
      stripeSubscriptionId: "sub_test_456",
      status: "active",
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 60_000,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    try {
      const first = await server.fetch(
        makeBillingRequest("/api/app/billing/portal", sessionId, {
          idempotencyKey: clientKey,
        }),
      );
      const second = await server.fetch(
        makeBillingRequest("/api/app/billing/portal", sessionId, {
          idempotencyKey: clientKey,
        }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const portalCalls = getFetchCallsByPath("/v1/billing_portal/sessions");
      expect(portalCalls).toHaveLength(2);
      expect(portalCalls[0]?.idempotencyKey).toBe(`portal-${clientKey}`);
      expect(portalCalls[1]?.idempotencyKey).toBe(`portal-${clientKey}`);
    } finally {
      server.stop(true);
    }
  });
});

describe("stripe webhook transport security", () => {
  test("accepts a proxied webhook when x-forwarded-proto is https", async () => {
    const server = createApiServer();
    const originalNodeEnv = config.nodeEnv;
    const originalIsProduction = config.isProduction;
    const originalEnforceHttps = config.enforceHttps;

    config.nodeEnv = "production";
    config.isProduction = true;
    config.enforceHttps = true;

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest(
          {
            id: "evt_proxy_https",
            type: "invoice.payment_failed",
            created: Math.floor(Date.now() / 1000),
            data: {
              object: {
                id: "in_proxy_https",
                customer: "cus_proxy_https",
              },
            },
          },
          {
            url: "http://api.bindersnap.test/stripe/webhook",
            headers: {
              "x-forwarded-proto": "https",
              "x-forwarded-for": "203.0.113.10",
            },
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    } finally {
      config.nodeEnv = originalNodeEnv;
      config.isProduction = originalIsProduction;
      config.enforceHttps = originalEnforceHttps;
      server.stop(true);
    }
  });

  test("rejects a proxied webhook when x-forwarded-proto is missing", async () => {
    const server = createApiServer();
    const originalNodeEnv = config.nodeEnv;
    const originalIsProduction = config.isProduction;
    const originalEnforceHttps = config.enforceHttps;

    config.nodeEnv = "production";
    config.isProduction = true;
    config.enforceHttps = true;

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest(
          {
            id: "evt_proxy_http",
            type: "invoice.payment_failed",
            created: Math.floor(Date.now() / 1000),
            data: {
              object: {
                id: "in_proxy_http",
                customer: "cus_proxy_http",
              },
            },
          },
          {
            url: "http://api.bindersnap.test/stripe/webhook",
          },
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "HTTPS is required." });
    } finally {
      config.nodeEnv = originalNodeEnv;
      config.isProduction = originalIsProduction;
      config.enforceHttps = originalEnforceHttps;
      server.stop(true);
    }
  });
});

describe("billing Stripe webhook recovery", () => {
  test("customer.subscription.updated recovers a missing subscription row from customer metadata", async () => {
    const server = createApiServer();
    const username = `recovery-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 3_600;

    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_username: username,
      },
    });

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest({
          id: `evt_${randomUUID()}`,
          type: "customer.subscription.updated",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: subscriptionId,
              customer: customerId,
              status: "active",
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: false,
              cancel_at: null,
            },
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(getFetchCallsByPath(`/v1/customers/${customerId}`)).toHaveLength(
        1,
      );
      expect(subscriptionStore.getByUsername(username)).toEqual({
        username,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: "active",
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        updatedAt: expect.any(Number),
      });
    } finally {
      server.stop(true);
    }
  });

  test("customer.subscription.deleted recovers a missing subscription row from customer metadata", async () => {
    const server = createApiServer();
    const username = `recovery-deleted-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const cancelAt = Math.floor(Date.now() / 1000) + 600;

    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_username: username,
      },
    });

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest({
          id: `evt_${randomUUID()}`,
          type: "customer.subscription.deleted",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: subscriptionId,
              customer: customerId,
              status: "canceled",
              cancel_at_period_end: true,
              cancel_at: cancelAt,
            },
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(getFetchCallsByPath(`/v1/customers/${customerId}`)).toHaveLength(
        1,
      );
      expect(subscriptionStore.getByUsername(username)).toEqual({
        username,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: "canceled",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: true,
        cancelAt,
        updatedAt: expect.any(Number),
      });
    } finally {
      server.stop(true);
    }
  });

  test("customer.subscription.created recovers a missing subscription row from customer metadata", async () => {
    const server = createApiServer();
    const username = `recovery-created-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 3_600;

    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_username: username,
      },
    });

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest({
          id: `evt_${randomUUID()}`,
          type: "customer.subscription.created",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: subscriptionId,
              customer: customerId,
              status: "active",
              current_period_end: currentPeriodEnd,
              cancel_at_period_end: false,
              cancel_at: null,
            },
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(getFetchCallsByPath(`/v1/customers/${customerId}`)).toHaveLength(
        1,
      );
      expect(subscriptionStore.getByUsername(username)).toEqual({
        username,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: "active",
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        updatedAt: expect.any(Number),
      });
    } finally {
      server.stop(true);
    }
  });

  test("checkout.session.completed backfills bindersnap_username metadata onto Stripe Customer", async () => {
    const server = createApiServer();
    const username = `checkout-backfill-${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const currentPeriodEnd = Math.floor(Date.now() / 1000) + 3_600;

    mockStripeSubscription(subscriptionId, {
      id: subscriptionId,
      customer: customerId,
      status: "active",
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: false,
      cancel_at: null,
    });

    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {},
    });

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest({
          id: `evt_${randomUUID()}`,
          type: "checkout.session.completed",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              client_reference_id: username,
              customer: customerId,
              subscription: subscriptionId,
            },
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(
        getFetchCallsByPath(`/v1/subscriptions/${subscriptionId}`),
      ).toHaveLength(1);

      // Verify customer metadata was backfilled
      const customerUpdateCalls = fetchCalls.filter(
        (c) => c.path === `/v1/customers/${customerId}` && c.method === "POST",
      );
      expect(customerUpdateCalls).toHaveLength(1);
      const updateBody = new URLSearchParams(
        customerUpdateCalls[0]!.body ?? "",
      );
      expect(updateBody.get("metadata[bindersnap_username]")).toBe(username);

      expect(subscriptionStore.getByUsername(username)).toEqual({
        username,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: "active",
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        updatedAt: expect.any(Number),
      });
    } finally {
      server.stop(true);
    }
  });

  test("customer.subscription.updated does not recover when customer metadata omits the bindersnap username", async () => {
    const server = createApiServer();
    const customerId = `cus_${randomUUID()}`;

    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {},
    });

    try {
      const response = await server.fetch(
        await makeStripeWebhookRequest({
          id: `evt_${randomUUID()}`,
          type: "customer.subscription.updated",
          created: Math.floor(Date.now() / 1000),
          data: {
            object: {
              id: `sub_${randomUUID()}`,
              customer: customerId,
              status: "active",
              current_period_end: Math.floor(Date.now() / 1000) + 1_800,
              cancel_at_period_end: false,
              cancel_at: null,
            },
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(getFetchCallsByPath(`/v1/customers/${customerId}`)).toHaveLength(
        1,
      );
      expect(subscriptionStore.getByCustomerId(customerId)).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});
