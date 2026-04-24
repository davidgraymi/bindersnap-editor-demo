/**
 * Stripe subscription integration tests.
 *
 * Exercises the full subscription lifecycle via direct API calls and webhook
 * delivery — no browser interaction required. Each test signs up a unique
 * user, fires Stripe webhook events with valid HMAC-SHA256 signatures, and
 * asserts on billing status and document API access.
 *
 * Requirements (set in tests/.env or environment):
 *   STRIPE_SECRET_KEY=sk_test_...   Real Stripe test-mode secret key
 *   STRIPE_WEBHOOK_SECRET=whsec_... Webhook signing secret (from the Stripe
 *                                   Dashboard endpoint or `stripe listen --print-secret`)
 *   STRIPE_PRICE_ID=price_...       The $100/mo price ID
 *   BUN_PUBLIC_API_BASE_URL         API base URL (default: http://localhost:8787)
 *   BINDERSNAP_APP_ORIGIN           Allowed CORS origin (default: http://localhost:5173)
 *
 * Tests that require Stripe credentials are individually skipped when they are
 * not present, so the suite never hard-fails in environments where Stripe is
 * not configured.
 *
 * Run with:
 *   SKIP_STACK=1 bun run test:integration -- tests/stripe-subscription.pw.ts
 */

import { test, expect, type Page } from "@playwright/test";
import { resolveStripeWebhookSecret } from "./stripe-runtime";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const API_BASE_URL =
  process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

const APP_ORIGIN =
  process.env.BINDERSNAP_APP_ORIGIN ??
  `http://localhost:${process.env.APP_PORT ?? "5173"}`;

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const STRIPE_WEBHOOK_SECRET = resolveStripeWebhookSecret();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID ?? "").trim();

const stripeKeySet = STRIPE_SECRET_KEY.startsWith("sk_test_");
const webhookSecretSet = STRIPE_WEBHOOK_SECRET !== "";
const priceIdSet = STRIPE_PRICE_ID !== "";
const stripeFullyConfigured = stripeKeySet && webhookSecretSet && priceIdSet;

// ---------------------------------------------------------------------------
// Helpers — Stripe API
// ---------------------------------------------------------------------------

/**
 * Build a valid stripe-signature header value using the same HMAC-SHA256
 * algorithm that services/api/stripe/webhook.ts verifies.
 */
async function signWebhookBody(body: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${body}`;

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
    encoder.encode(signedPayload),
  );

  const hex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},v1=${hex}`;
}

/** POST a signed webhook event to the running API. */
async function postWebhook(
  type: string,
  object: Record<string, unknown>,
): Promise<Response> {
  const event = {
    id: `evt_test_${Date.now()}`,
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };

  const body = JSON.stringify(event);
  const sig = await signWebhookBody(body, STRIPE_WEBHOOK_SECRET);

  return fetch(`${API_BASE_URL}/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": sig,
    },
    body,
  });
}

/** Call Stripe's test API. Throws on non-2xx responses. */
async function stripeFetch(
  path: string,
  body?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errMsg =
      (json.error as Record<string, unknown> | undefined)?.message ??
      JSON.stringify(json);
    throw new Error(
      `Stripe ${body ? "POST" : "GET"} ${path} failed (${response.status}): ${errMsg}`,
    );
  }

  return json;
}

/**
 * Create a Stripe test Customer + Subscription in trial mode.
 *
 * Uses the 4242 test card — no real charge is made. The subscription is
 * placed in `trialing` status so the webhook handler can successfully fetch
 * it from Stripe.
 */
async function createTestCustomerAndSubscription(username: string): Promise<{
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: number;
}> {
  // Customer
  const customer = await stripeFetch(
    "/v1/customers",
    new URLSearchParams({
      "metadata[bindersnap_username]": username,
    }),
  );
  const customerId = customer.id as string;

  // Use Stripe's pre-built test payment method token — raw card numbers are
  // rejected by the API unless the account has special access enabled.
  // Attaching pm_card_visa clones it into a new PM with a fresh ID; capture
  // that ID from the attach response to use as the customer's default.
  const attachedPm = await stripeFetch(
    "/v1/payment_methods/pm_card_visa/attach",
    new URLSearchParams({ customer: customerId }),
  );
  const attachedPmId = attachedPm.id as string;

  await stripeFetch(
    `/v1/customers/${customerId}`,
    new URLSearchParams({
      "invoice_settings[default_payment_method]": attachedPmId,
    }),
  );

  // Subscription with a 1-day trial — no charge during tests
  const subscription = await stripeFetch(
    "/v1/subscriptions",
    new URLSearchParams({
      customer: customerId,
      "items[0][price]": STRIPE_PRICE_ID,
      trial_period_days: "1",
    }),
  );

  // Stripe's newer API omits current_period_end for trialing subscriptions;
  // trial_end carries the same timestamp in that case.
  const currentPeriodEnd = (
    typeof subscription.current_period_end === "number"
      ? subscription.current_period_end
      : subscription.trial_end
  ) as number;

  return {
    customerId,
    subscriptionId: subscription.id as string,
    currentPeriodEnd,
  };
}

/** Cancel a Stripe subscription. Best-effort — ignores errors during cleanup. */
async function cancelTestSubscription(subscriptionId: string): Promise<void> {
  await stripeFetch(
    `/v1/subscriptions/${subscriptionId}/cancel`,
    new URLSearchParams(),
  ).catch(() => undefined);
}

async function cancelSubscriptionsForEmail(email: string): Promise<void> {
  const customers = await stripeFetch(
    `/v1/customers?email=${encodeURIComponent(email)}&limit=10`,
  ).catch(() => null);
  const customerRows = Array.isArray(customers?.data)
    ? (customers.data as Array<Record<string, unknown>>)
    : [];

  for (const customer of customerRows) {
    if (typeof customer.id !== "string" || customer.id.trim() === "") {
      continue;
    }

    const subscriptions = await stripeFetch(
      `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=10`,
    ).catch(() => null);
    const subscriptionRows = Array.isArray(subscriptions?.data)
      ? (subscriptions.data as Array<Record<string, unknown>>)
      : [];

    for (const subscription of subscriptionRows) {
      if (
        typeof subscription.id !== "string" ||
        subscription.id.trim() === "" ||
        subscription.status === "canceled"
      ) {
        continue;
      }

      await cancelTestSubscription(subscription.id);
    }
  }
}

async function fillVisibleInputAcrossFrames(
  page: Page,
  selectors: string[],
  value: string,
  options: { required?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15_000;

  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        const visible = await field.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        await field.fill(value);
        return true;
      }
    }

    await page.waitForTimeout(250);
  }

  if (options.required) {
    throw new Error(
      `Could not find a visible Stripe field for selectors: ${selectors.join(", ")}`,
    );
  }

  return false;
}

async function completeHostedStripeCheckout(
  page: Page,
  email: string,
): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // Email field is type="text" with autocomplete="email" on Stripe Hosted Checkout.
  await fillVisibleInputAcrossFrames(
    page,
    ['input[autocomplete="email"]', 'input[type="email"]', "#email"],
    email,
    { required: true },
  );

  // The Card radio is visually hidden under a custom overlay (no accessible name,
  // so getByRole doesn't match). Force-click by ID to expand the card form.
  // Falls back silently if the payment method selector isn't shown.
  await page
    .locator("#payment-method-accordion-item-title-card")
    .click({ force: true, timeout: 5_000 })
    .catch(() => {
      // No payment method accordion — card fields are already visible.
    });

  // Wait for the card number field to appear after the accordion opens.
  await page
    .waitForSelector('#cardNumber, input[autocomplete="cc-number"]', {
      timeout: 10_000,
    })
    .catch(() => {});

  // Stripe Link ("Save my information for faster checkout") is checked by
  // default and shows a required phone number field that blocks submission.
  // Uncheck it to keep the flow simple.
  await page
    .locator("#enableStripePass")
    .uncheck({ timeout: 3_000 })
    .catch(() => {});

  // All card fields render in the main frame (no Stripe.js iframes on
  // checkout.stripe.com since Stripe owns the whole origin).
  await fillVisibleInputAcrossFrames(
    page,
    ["#billingName", 'input[autocomplete="cc-name"]'],
    "Bindersnap Test",
  );
  await fillVisibleInputAcrossFrames(
    page,
    [
      "#cardNumber",
      'input[autocomplete="cc-number"]',
      'input[name="cardNumber"]',
    ],
    "4242424242424242",
    { required: true },
  );
  await fillVisibleInputAcrossFrames(
    page,
    ["#cardExpiry", 'input[autocomplete="cc-exp"]', 'input[name="cardExpiry"]'],
    "1234",
    { required: true },
  );
  await fillVisibleInputAcrossFrames(
    page,
    ["#cardCvc", 'input[autocomplete="cc-csc"]', 'input[name="cardCvc"]'],
    "123",
    { required: true },
  );
  await fillVisibleInputAcrossFrames(
    page,
    [
      "#billingPostalCode",
      'input[autocomplete="billing postal-code"]',
      'input[autocomplete="postal-code"]',
    ],
    "60601",
  );

  // The Stripe Checkout page also has an accordion toggle button with
  // aria-label="Pay with card" which matches /pay/i but is hidden.
  // Use data-testid for the real submit button; fall back to the Subscribe text.
  const submitButton = page
    .locator('[data-testid="hosted-payment-submit-button"]')
    .or(page.getByRole("button", { name: /subscribe|start[\s-]trial/i }))
    .first();
  await expect(submitButton).toBeVisible({ timeout: 15_000 });
  await submitButton.click();
}

// ---------------------------------------------------------------------------
// Helpers — Bindersnap API
// ---------------------------------------------------------------------------

/** Sign up a new user and return the session cookie value. */
async function signUpUser(credentials: {
  username: string;
  email: string;
  password: string;
}): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Origin is required — signup goes through CORS origin enforcement.
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(`Signup failed (${response.status}): ${body}`);
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/bindersnap_session=([^;]+)/);
  if (!match?.[1]) {
    throw new Error("No bindersnap_session cookie in signup response");
  }
  return match[1];
}

interface BillingStatusPayload {
  status: string | null;
  currentPeriodEnd: number | null;
}

async function getBillingStatus(
  sessionCookie: string,
): Promise<BillingStatusPayload> {
  const response = await fetch(`${API_BASE_URL}/api/app/billing/status`, {
    headers: { Cookie: `bindersnap_session=${sessionCookie}` },
  });
  return response.json() as Promise<BillingStatusPayload>;
}

async function getDocumentsHttpStatus(sessionCookie: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/app/documents`, {
    headers: { Cookie: `bindersnap_session=${sessionCookie}` },
  });
  return response.status;
}

function uniqueCredentials() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    username: `stripe-${suffix}`,
    email: `stripe-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Stripe subscription lifecycle", () => {
  // Individual Stripe API calls can take several seconds.
  // Full lifecycle (Customer + PM + Subscription + webhooks) needs more room.
  test.setTimeout(60_000);

  // -------------------------------------------------------------------------
  // 1. Signature verification — no Stripe key required
  // -------------------------------------------------------------------------

  test("rejects webhook with an invalid signature", async () => {
    test.skip(!webhookSecretSet, "STRIPE_WEBHOOK_SECRET not set");

    const body = JSON.stringify({
      id: "evt_test_bad",
      type: "checkout.session.completed",
      data: { object: {} },
    });

    const response = await fetch(`${API_BASE_URL}/stripe/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=12345,v1=0000000000000000",
      },
      body,
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/signature/i);
  });

  // -------------------------------------------------------------------------
  // 2. Paywall enforcement — no Stripe key required
  // -------------------------------------------------------------------------

  test("new user has no subscription and is blocked by the paywall", async () => {
    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);

    const billingStatus = await getBillingStatus(sessionCookie);
    expect(billingStatus.status).toBeNull();
    expect(billingStatus.currentPeriodEnd).toBeNull();

    const docsStatus = await getDocumentsHttpStatus(sessionCookie);
    expect(docsStatus).toBe(402);
  });

  // -------------------------------------------------------------------------
  // 3–6. Full lifecycle — Stripe test API required
  // -------------------------------------------------------------------------

  test("checkout.session.completed activates the subscription and grants document access", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);

    // Pre-condition: paywalled
    expect(await getDocumentsHttpStatus(sessionCookie)).toBe(402);

    const { customerId, subscriptionId } =
      await createTestCustomerAndSubscription(credentials.username);

    try {
      const webhookResp = await postWebhook("checkout.session.completed", {
        id: `cs_test_${Date.now()}`,
        client_reference_id: credentials.username,
        customer: customerId,
        subscription: subscriptionId,
        payment_status: "paid",
      });

      expect(webhookResp.ok).toBe(true);
      const webhookBody = (await webhookResp.json()) as { received: boolean };
      expect(webhookBody.received).toBe(true);

      // The server fetches subscription details from Stripe — status will be
      // "trialing" because we created the subscription with a 1-day trial.
      const billing = await getBillingStatus(sessionCookie);
      expect(["active", "trialing"]).toContain(billing.status);
      expect(typeof billing.currentPeriodEnd).toBe("number");

      // Access should now be granted
      expect(await getDocumentsHttpStatus(sessionCookie)).toBe(200);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.updated to past_due revokes document access", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(credentials.username);

    try {
      // Activate via checkout webhook
      await postWebhook("checkout.session.completed", {
        client_reference_id: credentials.username,
        customer: customerId,
        subscription: subscriptionId,
      });
      expect(await getDocumentsHttpStatus(sessionCookie)).toBe(200);

      // Simulate Stripe dunning: payment fails → subscription moves to past_due
      const updateResp = await postWebhook("customer.subscription.updated", {
        id: subscriptionId,
        customer: customerId,
        status: "past_due",
        current_period_end: currentPeriodEnd,
      });
      expect(updateResp.ok).toBe(true);

      const billing = await getBillingStatus(sessionCookie);
      expect(billing.status).toBe("past_due");

      // Access must be revoked for past_due
      expect(await getDocumentsHttpStatus(sessionCookie)).toBe(402);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.updated back to active restores access after past_due", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(credentials.username);

    try {
      await postWebhook("checkout.session.completed", {
        client_reference_id: credentials.username,
        customer: customerId,
        subscription: subscriptionId,
      });

      // Move to past_due
      await postWebhook("customer.subscription.updated", {
        id: subscriptionId,
        customer: customerId,
        status: "past_due",
        current_period_end: currentPeriodEnd,
      });
      expect(await getDocumentsHttpStatus(sessionCookie)).toBe(402);

      // Simulate successful payment retry → active
      const renewedPeriodEnd = currentPeriodEnd + 30 * 24 * 60 * 60;
      await postWebhook("customer.subscription.updated", {
        id: subscriptionId,
        customer: customerId,
        status: "active",
        current_period_end: renewedPeriodEnd,
      });

      const billing = await getBillingStatus(sessionCookie);
      expect(billing.status).toBe("active");
      expect(billing.currentPeriodEnd).toBe(renewedPeriodEnd);
      expect(await getDocumentsHttpStatus(sessionCookie)).toBe(200);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.deleted marks the subscription canceled", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(credentials.username);

    // Activate
    await postWebhook("checkout.session.completed", {
      client_reference_id: credentials.username,
      customer: customerId,
      subscription: subscriptionId,
    });
    expect(await getDocumentsHttpStatus(sessionCookie)).toBe(200);

    // Delete — no cleanup needed, subscription is being canceled here
    const deleteResp = await postWebhook("customer.subscription.deleted", {
      id: subscriptionId,
      customer: customerId,
      status: "canceled",
      current_period_end: currentPeriodEnd,
    });
    expect(deleteResp.ok).toBe(true);

    const billing = await getBillingStatus(sessionCookie);
    expect(billing.status).toBe("canceled");
    expect(await getDocumentsHttpStatus(sessionCookie)).toBe(402);
  });

  test("billing/checkout returns a Stripe Checkout Session URL", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const sessionCookie = await signUpUser(credentials);

    const response = await fetch(`${API_BASE_URL}/api/app/billing/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Origin required — this endpoint is behind CORS origin enforcement.
        Origin: APP_ORIGIN,
        Cookie: `bindersnap_session=${sessionCookie}`,
      },
    });

    expect(response.ok).toBe(true);
    const body = (await response.json()) as { url?: string };
    expect(typeof body.url).toBe("string");
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  test("hosted Stripe Checkout redirects back and unlocks the workspace", async ({
    page,
  }) => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");
    test.setTimeout(120_000);

    const credentials = uniqueCredentials();

    try {
      await page.goto("/signup");
      await page.getByLabel("Username").fill(credentials.username);
      await page.getByLabel("Email").fill(credentials.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(credentials.password);
      await page
        .getByLabel("Confirm Password", { exact: true })
        .fill(credentials.password);
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page).toHaveURL(/\/billing$/, { timeout: 20_000 });
      await expect(
        page.getByRole("heading", { name: "Start your subscription" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Subscribe now" }).click();
      await completeHostedStripeCheckout(page, credentials.email);

      await expect(page).toHaveURL(/\/billing\?checkout=success/, {
        timeout: 60_000,
      });
      await expect(
        page.getByRole("heading", {
          name: "Payment received — activating your workspace…",
        }),
      ).toBeVisible({ timeout: 20_000 });

      await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
      await expect(
        page.locator(
          `.app-topnav-avatar[aria-label="User: ${credentials.username}"]`,
        ),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await cancelSubscriptionsForEmail(credentials.email);
    }
  });
});
