import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";

import { config } from "./config";
import { OrganizationStore, organizationStore } from "./organizations";
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

type MockedGiteaUser = {
  login: string;
  email: string;
  fullName?: string;
  isAdmin?: boolean;
};

const originalFetch = globalThis.fetch;
const originalApiPort = config.apiPort;
const originalStripeSecretKey = config.stripeSecretKey;
const originalStripeWebhookSecret = config.stripeWebhookSecret;
const originalStripePriceId = config.stripePriceId;
const originalSessionsDbPath = config.sessionsDbPath;

let fetchCalls: MockedFetchCall[] = [];
let giteaUsersByLogin = new Map<string, MockedGiteaUser>();
let giteaLoginsByToken = new Map<string, string>();
// ADR 0004: billing keys to the organization, so every seeded session needs
// one. `orgIdFor` is what a test uses to seed or assert a subscription row.
let giteaOrgsByUsername = new Map<string, { id: number; username: string }>();
// org name -> its Owners team members, for the admin browse listing.
let giteaOrgOwners = new Map<string, MockedGiteaUser[]>();
let nextGiteaOrgId = 4000;
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
  (organizationStore as { _store: OrganizationStore | null })._store =
    new OrganizationStore(config.sessionsDbPath);

  fetchCalls = [];
  giteaUsersByLogin = new Map();
  giteaLoginsByToken = new Map();
  giteaOrgsByUsername = new Map();
  giteaOrgOwners = new Map();
  nextGiteaOrgId = 4000;
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
    // openapi-fetch calls fetch(new Request(...)) rather than fetch(url, init),
    // so the auth header lives on the Request for typed-client calls.
    const headers =
      input instanceof Request
        ? new Headers(input.headers)
        : new Headers(init?.headers);
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

    const orgTeamsMatch = url.pathname.match(
      /^\/api\/v1\/orgs\/([^/]+)\/teams$/,
    );
    if (orgTeamsMatch) {
      const orgName = decodeURIComponent(orgTeamsMatch[1] ?? "");
      const teams = giteaOrgOwners.has(orgName)
        ? [
            {
              id: ownersTeamIdFor(orgName),
              name: "Owners",
              permission: "owner",
            },
          ]
        : [];
      return new Response(JSON.stringify(teams), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const teamMembersMatch = url.pathname.match(
      /^\/api\/v1\/teams\/(\d+)\/members$/,
    );
    if (teamMembersMatch) {
      const teamId = Number.parseInt(teamMembersMatch[1] ?? "0", 10);
      const orgName = [...giteaOrgOwners.keys()].find(
        (name) => ownersTeamIdFor(name) === teamId,
      );
      const members = orgName ? (giteaOrgOwners.get(orgName) ?? []) : [];
      return new Response(
        JSON.stringify(
          members.map((member, index) => ({
            id: index + 1,
            login: member.login,
            full_name: member.fullName ?? "",
            email: member.email,
          })),
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const userOrgsMatch = url.pathname.match(
      /^\/api\/v1\/users\/([^/]+)\/orgs$/,
    );
    if (userOrgsMatch) {
      const organization = giteaOrgsByUsername.get(
        decodeURIComponent(userOrgsMatch[1] ?? ""),
      );
      return new Response(JSON.stringify(organization ? [organization] : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/v1/user/orgs") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ")
        ? authHeader.slice("token ".length)
        : "";
      const login = giteaLoginsByToken.get(token);
      const organization = login ? giteaOrgsByUsername.get(login) : null;
      return new Response(JSON.stringify(organization ? [organization] : []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/v1/user") {
      const authHeader = headers.get("Authorization") ?? "";
      const token = authHeader.startsWith("token ")
        ? authHeader.slice("token ".length)
        : "";
      const login = giteaLoginsByToken.get(token);
      const user = login ? giteaUsersByLogin.get(login) : null;

      if (!user) {
        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      return new Response(
        JSON.stringify({
          login: user.login,
          email: user.email,
          full_name: user.fullName ?? "",
          is_admin: user.isAdmin === true,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    if (url.pathname === "/api/v1/users/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
      const matchedUsers = [...giteaUsersByLogin.values()].filter((user) => {
        if (query === "") {
          return true;
        }

        return (
          user.login.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query) ||
          (user.fullName ?? "").toLowerCase().includes(query)
        );
      });
      const start = Math.max(0, (page - 1) * limit);
      const pageUsers = matchedUsers.slice(start, start + limit);

      return new Response(
        JSON.stringify({
          ok: true,
          data: pageUsers.map((user, index) => ({
            id: index + 1,
            login: user.login,
            full_name: user.fullName ?? "",
            email: user.email,
            avatar_url: "",
          })),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
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

async function seedSession(
  username: string,
  options?: {
    email?: string;
    fullName?: string;
    isAdmin?: boolean;
    /** Pass false for an account that predates ADR 0004 and has no org. */
    withOrganization?: boolean;
  },
): Promise<string> {
  const sessionId = `sess_${randomUUID()}`;
  const giteaToken = `gitea_token_${randomUUID()}`;
  const email =
    options?.email ?? `${username.toLowerCase()}@${config.emailDomain}`;

  if (options?.withOrganization !== false) {
    nextGiteaOrgId += 1;
    giteaOrgsByUsername.set(username, {
      id: nextGiteaOrgId,
      username: `${username}-org`,
    });
  }

  giteaUsersByLogin.set(username, {
    login: username,
    email,
    fullName: options?.fullName,
    isAdmin: options?.isAdmin === true,
  });
  giteaLoginsByToken.set(giteaToken, username);
  await sessionStore.put({
    id: sessionId,
    username,
    giteaToken,
    giteaTokenName: "bindersnap-test-token",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  return sessionId;
}

/** A stable synthetic team id for an org's Owners team. */
function ownersTeamIdFor(orgName: string): number {
  let hash = 0;
  for (const char of orgName) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }
  return 900_000 + hash;
}

/** Register an organization for a user without creating a session for them. */
function seedOrganizationFor(username: string): number {
  nextGiteaOrgId += 1;
  giteaOrgsByUsername.set(username, {
    id: nextGiteaOrgId,
    username: `${username}-org`,
  });
  return nextGiteaOrgId;
}

/** The Gitea org id seeded for a user. Billing hangs off this, not the name. */
function orgIdFor(username: string): number {
  const organization = giteaOrgsByUsername.get(username);
  if (!organization) {
    throw new Error(`No organization was seeded for ${username}.`);
  }
  return organization.id;
}

function getFetchCallsByPath(path: string): MockedFetchCall[] {
  return fetchCalls.filter((call) => call.path === path);
}

function seedGiteaUser(user: MockedGiteaUser): void {
  giteaUsersByLogin.set(user.login, user);
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

function makeSessionRequest(
  pathname: string,
  sessionId: string,
  options?: {
    method?: string;
    body?: Record<string, unknown>;
  },
): Request {
  const method = options?.method ?? "GET";
  const body = options?.body;

  return new Request(`http://localhost${pathname}`, {
    method,
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
    const sessionId = await seedSession(username);

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
    const sessionId = await seedSession(username);
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
    const sessionId = await seedSession(username);

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

  test("checkout carries the organization, not the person, into Stripe", async () => {
    const server = createApiServer();
    const username = `checkout-metadata-${randomUUID()}`;
    const email = `${username}@${config.emailDomain}`;
    const sessionId = await seedSession(username, { email });

    try {
      const response = await server.fetch(
        makeBillingRequest("/api/app/billing/checkout", sessionId),
      );

      expect(response.status).toBe(200);
      const checkoutCalls = getFetchCallsByPath("/v1/checkout/sessions");
      expect(checkoutCalls).toHaveLength(1);

      const form = getPostedFormBody(checkoutCalls[0]!);
      expect(form.get("customer_email")).toBe(email);
      // The org id is the key Stripe carries; the username records who set it
      // up, which support wants and billing must never depend on.
      expect(form.get("metadata[bindersnap_gitea_org_id]")).toBe(
        String(orgIdFor(username)),
      );
      expect(form.get("client_reference_id")).toBe(String(orgIdFor(username)));
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
    const sessionId = await seedSession(username, { email });

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(username),
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
      expect(form.get("metadata[bindersnap_gitea_org_id]")).toBe(
        String(orgIdFor(username)),
      );
    } finally {
      server.stop(true);
    }
  });

  test("portal sends a unique Stripe Idempotency-Key per attempt when no client key provided", async () => {
    const server = createApiServer();
    const username = `portal-${randomUUID()}`;
    const sessionId = await seedSession(username);

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(username),
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
    const sessionId = await seedSession(username);
    const clientKey = randomUUID();

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(username),
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

    const giteaOrgId = seedOrganizationFor(username);
    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_gitea_org_id: String(giteaOrgId),
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
      expect(await subscriptionStore.getByOrganization(giteaOrgId)).toEqual({
        giteaOrgId,
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

    const giteaOrgId = seedOrganizationFor(username);
    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_gitea_org_id: String(giteaOrgId),
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
      expect(await subscriptionStore.getByOrganization(giteaOrgId)).toEqual({
        giteaOrgId,
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

    const giteaOrgId = seedOrganizationFor(username);
    mockStripeCustomer(customerId, {
      id: customerId,
      metadata: {
        bindersnap_gitea_org_id: String(giteaOrgId),
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
      expect(await subscriptionStore.getByOrganization(giteaOrgId)).toEqual({
        giteaOrgId,
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

  test("checkout.session.completed stamps the organization onto the Stripe customer", async () => {
    const server = createApiServer();
    const username = `checkout-backfill-${randomUUID()}`;
    const giteaOrgId = seedOrganizationFor(username);
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
              // Checkout is bought by an organization, so this is its id.
              client_reference_id: String(giteaOrgId),
              metadata: { bindersnap_username: username },
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

      // Later subscription webhooks carry only a customer, so the org id has
      // to be stamped onto it or they cannot reconcile.
      const customerUpdateCalls = fetchCalls.filter(
        (c) => c.path === `/v1/customers/${customerId}` && c.method === "POST",
      );
      expect(customerUpdateCalls).toHaveLength(1);
      const updateBody = new URLSearchParams(
        customerUpdateCalls[0]!.body ?? "",
      );
      expect(updateBody.get("metadata[bindersnap_gitea_org_id]")).toBe(
        String(giteaOrgId),
      );
      expect(updateBody.get("metadata[bindersnap_username]")).toBe(username);

      expect(await subscriptionStore.getByOrganization(giteaOrgId)).toEqual({
        giteaOrgId,
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
      expect(await subscriptionStore.getByCustomerId(customerId)).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});

describe("admin subscription access overrides", () => {
  test("auth/me exposes the current user's admin flag", async () => {
    const server = createApiServer();
    const sessionId = await seedSession(`admin-${randomUUID()}`, {
      isAdmin: true,
      fullName: "Admin User",
    });

    try {
      const response = await server.fetch(
        makeSessionRequest("/auth/me", sessionId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        user: {
          username: expect.stringMatching(/^admin-/),
          fullName: "Admin User",
          isAdmin: true,
        },
        token: expect.stringMatching(/^gitea_token_/),
      });
    } finally {
      server.stop(true);
    }
  });

  test("billing status reflects an admin revoke override over an active Stripe subscription", async () => {
    const server = createApiServer();
    const username = `revoked-${randomUUID()}`;
    const sessionId = await seedSession(username);

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(username),
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      status: "active",
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 3_600,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    await subscriptionStore.putAccessOverride({
      giteaOrgId: orgIdFor(username),
      access: "revoke",
      reason: "manual review hold",
      updatedBy: "admin-user",
      updatedAt: Date.now(),
    });

    try {
      const response = await server.fetch(
        makeSessionRequest("/api/app/billing/status", sessionId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "revoked",
        stripeStatus: "active",
        hasAccess: false,
        accessSource: "admin_revoke",
        override: {
          access: "revoke",
          mode: "revoke",
          reason: "manual review hold",
          updatedBy: "admin-user",
        },
      });
    } finally {
      server.stop(true);
    }
  });

  test("admin list without a query walks organizations and names each by an owner", async () => {
    const server = createApiServer();
    const adminSessionId = await seedSession(`admin-${randomUUID()}`, {
      isAdmin: true,
    });
    const stripeUser = `stripe-${randomUUID()}`;
    const overrideUser = `override-${randomUUID()}`;

    seedGiteaUser({
      login: stripeUser,
      email: `${stripeUser}@${config.emailDomain}`,
    });
    seedGiteaUser({
      login: overrideUser,
      email: `${overrideUser}@${config.emailDomain}`,
    });

    // Browsing lists organizations, because that is what we know billing
    // about — and labels each row with one of its owners, since a username is
    // what an admin can act on.
    for (const user of [stripeUser, overrideUser]) {
      const giteaOrgId = seedOrganizationFor(user);
      const orgName = `${user}-org`;
      giteaOrgOwners.set(orgName, [
        { login: user, email: `${user}@${config.emailDomain}` },
      ]);
      await organizationStore.upsert({
        giteaOrgId,
        name: orgName,
        createdBy: user,
        createdAt: Math.floor(Date.now() / 1000),
        trialEndsAt: null,
      });
    }

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(stripeUser),
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      status: "active",
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 3_600,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now() - 1_000,
    });
    await subscriptionStore.putAccessOverride({
      giteaOrgId: orgIdFor(overrideUser),
      access: "grant",
      reason: "manual comp",
      updatedBy: "admin-user",
      updatedAt: Date.now(),
    });

    try {
      const response = await server.fetch(
        makeSessionRequest(
          "/api/app/admin/subscriptions/access",
          adminSessionId,
        ),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        users: Array<{ username: string; accessSource: string }>;
      };
      expect(payload.users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            username: stripeUser,
            accessSource: "stripe",
          }),
          expect.objectContaining({
            username: overrideUser,
            accessSource: "admin_grant",
          }),
        ]),
      );
    } finally {
      server.stop(true);
    }
  });

  test("only admins can mutate overrides, and revoke blocks subscription-gated routes until cleared", async () => {
    const server = createApiServer();
    const adminUsername = `admin-${randomUUID()}`;
    const memberUsername = `member-${randomUUID()}`;
    const outsiderSessionId = await seedSession(`outsider-${randomUUID()}`);
    const adminSessionId = await seedSession(adminUsername, { isAdmin: true });
    const memberSessionId = await seedSession(memberUsername);

    await subscriptionStore.upsert({
      giteaOrgId: orgIdFor(memberUsername),
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      status: "active",
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 3_600,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    try {
      const forbidden = await server.fetch(
        makeSessionRequest(
          "/api/app/admin/subscriptions/access",
          outsiderSessionId,
        ),
      );
      expect(forbidden.status).toBe(403);

      const revoke = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
          adminSessionId,
          {
            method: "PUT",
            body: {
              access: "revoke",
              reason: "chargeback",
            },
          },
        ),
      );

      expect(revoke.status).toBe(200);
      expect(await revoke.json()).toMatchObject({
        user: {
          username: memberUsername,
          hasAccess: false,
          accessSource: "admin_revoke",
          override: {
            reason: "chargeback",
            access: "revoke",
          },
        },
      });

      const gatedWhileRevoked = await server.fetch(
        makeSessionRequest(
          `/api/app/users/search?q=${encodeURIComponent(adminUsername)}`,
          memberSessionId,
        ),
      );
      expect(gatedWhileRevoked.status).toBe(402);

      const clear = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
          adminSessionId,
          { method: "DELETE" },
        ),
      );
      expect(clear.status).toBe(200);

      const gatedAfterClear = await server.fetch(
        makeSessionRequest(
          `/api/app/users/search?q=${encodeURIComponent(adminUsername)}`,
          memberSessionId,
        ),
      );
      expect(gatedAfterClear.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  test("an admin grant opens subscription-gated routes for a user with no subscription", async () => {
    const server = createApiServer();
    const adminUsername = `admin-${randomUUID()}`;
    const memberUsername = `member-${randomUUID()}`;
    const adminSessionId = await seedSession(adminUsername, { isAdmin: true });
    const memberSessionId = await seedSession(memberUsername);

    seedGiteaUser({
      login: memberUsername,
      email: `${memberUsername}@${config.emailDomain}`,
    });

    try {
      // Nothing has been granted yet, so the paywall is closed.
      const gatedBefore = await server.fetch(
        makeSessionRequest(
          `/api/app/users/search?q=${encodeURIComponent(adminUsername)}`,
          memberSessionId,
        ),
      );
      expect(gatedBefore.status).toBe(402);

      const grant = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
          adminSessionId,
          { method: "PUT", body: { access: "grant", reason: "beta comp" } },
        ),
      );

      expect(grant.status).toBe(200);
      expect(await grant.json()).toMatchObject({
        user: {
          username: memberUsername,
          hasAccess: true,
          accessSource: "admin_grant",
          override: {
            access: "grant",
            reason: "beta comp",
            updatedBy: adminUsername,
          },
        },
      });

      const openAfterGrant = await server.fetch(
        makeSessionRequest(
          `/api/app/users/search?q=${encodeURIComponent(adminUsername)}`,
          memberSessionId,
        ),
      );
      expect(openAfterGrant.status).toBe(200);

      // The grant is durable: a later read reports it, not just the write.
      const listed = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access?q=${encodeURIComponent(memberUsername)}`,
          adminSessionId,
        ),
      );
      expect(listed.status).toBe(200);
      const payload = (await listed.json()) as {
        users: Array<{ username: string; hasAccess: boolean }>;
      };
      expect(payload.users).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            username: memberUsername,
            hasAccess: true,
            accessSource: "admin_grant",
          }),
        ]),
      );
    } finally {
      server.stop(true);
    }
  });

  test("a grant flips to a revoke without needing a clear in between", async () => {
    const server = createApiServer();
    const adminUsername = `admin-${randomUUID()}`;
    const memberUsername = `member-${randomUUID()}`;
    const adminSessionId = await seedSession(adminUsername, { isAdmin: true });
    await seedSession(memberUsername);

    const setAccess = (access: "grant" | "revoke") =>
      server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
          adminSessionId,
          { method: "PUT", body: { access } },
        ),
      );

    try {
      expect(await (await setAccess("grant")).json()).toMatchObject({
        user: { hasAccess: true, accessSource: "admin_grant" },
      });
      expect(await (await setAccess("revoke")).json()).toMatchObject({
        user: { hasAccess: false, accessSource: "admin_revoke" },
      });
      expect(await (await setAccess("grant")).json()).toMatchObject({
        user: { hasAccess: true, accessSource: "admin_grant" },
      });
    } finally {
      server.stop(true);
    }
  });

  test("the paywall bypass list outranks an admin revoke", async () => {
    const server = createApiServer();
    const adminUsername = `admin-${randomUUID()}`;
    const bypassUsername = `bypassed-${randomUUID()}`;
    const adminSessionId = await seedSession(adminUsername, { isAdmin: true });
    const bypassSessionId = await seedSession(bypassUsername);

    config.bypassSubscriptionForUsers.push(bypassUsername);

    try {
      const revoke = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(bypassUsername)}`,
          adminSessionId,
          { method: "PUT", body: { access: "revoke" } },
        ),
      );

      expect(revoke.status).toBe(200);
      // The override is recorded, but config_bypass is resolved first, so the
      // revoke does not actually take away access. The admin UI leans on this
      // shape to tell the admin their revoke is inert.
      expect(await revoke.json()).toMatchObject({
        user: {
          username: bypassUsername,
          hasAccess: true,
          accessSource: "config_bypass",
          override: { access: "revoke", updatedBy: adminUsername },
        },
      });

      const stillOpen = await server.fetch(
        makeSessionRequest(
          `/api/app/users/search?q=${encodeURIComponent(adminUsername)}`,
          bypassSessionId,
        ),
      );
      expect(stillOpen.status).toBe(200);
    } finally {
      config.bypassSubscriptionForUsers =
        config.bypassSubscriptionForUsers.filter(
          (username) => username !== bypassUsername,
        );
      server.stop(true);
    }
  });

  test("an admin cannot grant or revoke their own access", async () => {
    const server = createApiServer();
    const adminUsername = `admin-${randomUUID()}`;
    const adminSessionId = await seedSession(adminUsername, { isAdmin: true });

    try {
      for (const method of ["PUT", "DELETE"] as const) {
        const response = await server.fetch(
          makeSessionRequest(
            `/api/app/admin/subscriptions/access/${encodeURIComponent(adminUsername)}`,
            adminSessionId,
            method === "PUT"
              ? { method, body: { access: "grant" } }
              : { method },
          ),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: "Admin overrides can only target another user.",
        });
      }
    } finally {
      server.stop(true);
    }
  });

  test("access must be grant or revoke", async () => {
    const server = createApiServer();
    const adminSessionId = await seedSession(`admin-${randomUUID()}`, {
      isAdmin: true,
    });
    const memberUsername = `member-${randomUUID()}`;

    try {
      for (const body of [{}, { access: "" }, { access: "delete" }]) {
        const response = await server.fetch(
          makeSessionRequest(
            `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
            adminSessionId,
            { method: "PUT", body },
          ),
        );

        expect(response.status).toBe(400);
      }
    } finally {
      server.stop(true);
    }
  });

  test("a non-admin cannot grant themselves access", async () => {
    const server = createApiServer();
    const memberUsername = `member-${randomUUID()}`;
    const memberSessionId = await seedSession(memberUsername);

    try {
      const response = await server.fetch(
        makeSessionRequest(
          `/api/app/admin/subscriptions/access/${encodeURIComponent(memberUsername)}`,
          memberSessionId,
          { method: "PUT", body: { access: "grant" } },
        ),
      );

      expect(response.status).toBe(403);

      const stillGated = await server.fetch(
        makeSessionRequest(`/api/app/users/search?q=someone`, memberSessionId),
      );
      expect(stillGated.status).toBe(402);
    } finally {
      server.stop(true);
    }
  });
});
