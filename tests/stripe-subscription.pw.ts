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
 *   BUN_PUBLIC_API_BASE_URL         API base URL (default: http://localhost:8788)
 *   BINDERSNAP_APP_ORIGIN           Allowed CORS origin (default: http://localhost:5173)
 *
 * Tests that require Stripe credentials are individually skipped when they are
 * not present, so the suite never hard-fails in environments where Stripe is
 * not configured.
 *
 * Run with:
 *   SKIP_STACK=1 bun run test:integration -- tests/stripe-subscription.pw.ts
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import { resolveStripeWebhookSecret } from "./stripe-runtime";
import { buildTestStripeEvent, signWebhookBody } from "./stripe-webhook";
import { STRIPE_API_VERSION } from "../services/api/stripe/api-version";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const API_BASE_URL =
  process.env.BUN_PUBLIC_API_BASE_URL ??
  `http://localhost:${process.env.API_PROXY_PORT ?? "8788"}`;

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

/** POST a signed webhook event to the running API. */
async function postWebhook(
  type: string,
  object: Record<string, unknown>,
): Promise<Response> {
  const { body } = buildTestStripeEvent(type, object);
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
      "Stripe-Version": STRIPE_API_VERSION,
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
async function createTestCustomerAndSubscription(giteaOrgId: number): Promise<{
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: number;
}> {
  // Customer. Billing keys to the organization (ADR 0004), so this is the id
  // every webhook reconciles from.
  const customer = await stripeFetch(
    "/v1/customers",
    new URLSearchParams({
      "metadata[bindersnap_gitea_org_id]": String(giteaOrgId),
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

async function waitForVisibleInputAcrossFrames(
  page: Page,
  selectors: string[],
  options: { required?: boolean; timeoutMs?: number } = {},
): Promise<Locator | null> {
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

        return field;
      }
    }

    await page.waitForTimeout(250);
  }

  if (options.required) {
    throw new Error(
      `Could not find a visible Stripe field for selectors: ${selectors.join(", ")}`,
    );
  }

  return null;
}

async function waitForVisibleTextAcrossFrames(
  page: Page,
  text: string,
  options: { required?: boolean; timeoutMs?: number } = {},
): Promise<Locator | null> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15_000;

  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const value = frame.getByText(text, { exact: true }).first();
      const visible = await value.isVisible().catch(() => false);
      if (visible) {
        return value;
      }
    }

    await page.waitForTimeout(250);
  }

  if (options.required) {
    throw new Error(`Could not find visible text in Stripe Checkout: ${text}`);
  }

  return null;
}

async function fillVisibleInputAcrossFrames(
  page: Page,
  selectors: string[],
  value: string,
  options: { required?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  const field = await waitForVisibleInputAcrossFrames(page, selectors, options);
  if (!field) {
    return false;
  }

  await field.fill(value);
  return true;
}

async function completeHostedStripeCheckout(
  page: Page,
  email: string,
): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // When Checkout receives customer_email or a Customer with a valid email,
  // Stripe may render the contact email as a locked value instead of an input.
  const emailField = await waitForVisibleInputAcrossFrames(
    page,
    ['input[autocomplete="email"]', 'input[type="email"]', "#email"],
    { timeoutMs: 5_000 },
  );
  if (emailField) {
    let prefilledEmail = "";
    const emailPrefillDeadline = Date.now() + 5_000;
    while (Date.now() < emailPrefillDeadline) {
      prefilledEmail = (await emailField.inputValue().catch(() => "")).trim();
      if (prefilledEmail !== "") {
        break;
      }
      await page.waitForTimeout(250);
    }

    if (prefilledEmail === "") {
      await emailField.fill(email);
    }
    await expect(emailField).toHaveValue(email);
  } else {
    const lockedEmail = await waitForVisibleTextAcrossFrames(page, email, {
      required: true,
      timeoutMs: 5_000,
    });
    await expect(lockedEmail).toBeVisible();
  }

  // The Card radio is visually hidden under a custom overlay in older Stripe
  // Checkout. Force-click by ID to expand the card form.
  const oldAccordionOpened = await page
    .locator("#payment-method-accordion-item-title-card")
    .click({ force: true, timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (!oldAccordionOpened) {
    // Newer Stripe Checkout renders a payment-method list where clicking the
    // Card radio selects it, and clicking the "Pay with card" button reveals
    // the card number / expiry / CVC fields.
    // The radio may be covered by a custom overlay, so force-click it.
    await page
      .getByRole("radio", { name: /card/i })
      .click({ force: true, timeout: 3_000 })
      .catch(() => {});
    // Use the first *visible* match so we don't accidentally trigger a hidden
    // accordion toggle that Stripe also renders with aria-label "Pay with card".
    await page
      .getByRole("button", { name: /pay with card/i })
      .filter({ visible: true })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {});
  }

  // Wait for the card number field to appear after the accordion opens.
  await page
    .waitForSelector(
      '#cardNumber, input[autocomplete="cc-number"], input[name="cardNumber"]',
      { timeout: 10_000 },
    )
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
  hasAccess?: boolean;
  accessSource?: string | null;
  trialEndsAt?: number | null;
  organization?: { id: number; name: string } | null;
}

/**
 * Sign up, then create the organization, and answer with both.
 *
 * Every test here needs the organization: it is what Stripe is keyed to, what
 * the paywall checks, and what owns the trial. Signup no longer provisions one
 * — ADR 0004 made naming it the owner's job — so the helper does what a person
 * would do next, rather than reading back an organization nobody asked for.
 */
async function signUpOrganization(credentials: {
  username: string;
  email: string;
  password: string;
}): Promise<{ sessionCookie: string; giteaOrgId: number }> {
  const sessionCookie = await signUpUser(credentials);

  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: {
      Cookie: `bindersnap_session=${sessionCookie}`,
      "Content-Type": "application/json",
      // A mutation, so it goes through the state-changing origin check.
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({ name: credentials.username }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(
      `Creating an organization for ${credentials.username} failed (${response.status}): ${body}`,
    );
  }

  const billing = await getBillingStatus(sessionCookie);
  const giteaOrgId = billing.organization?.id;

  if (!giteaOrgId) {
    throw new Error(
      `Billing status reported no organization for ${credentials.username} after creating one.`,
    );
  }

  return { sessionCookie, giteaOrgId };
}

/**
 * End the organization's trial, so the paywall is observable.
 *
 * A new organization has 14 days with no card (#369), and the trial sits below
 * Stripe in the precedence list — so a past_due subscription on a trialing
 * organization still has access. A test about Stripe revoking access has to
 * get past the trial first, or it is asserting nothing.
 */
async function endTrial(sessionCookie: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/dev/end-trial`, {
    method: "POST",
    headers: {
      Cookie: `bindersnap_session=${sessionCookie}`,
      Origin: APP_ORIGIN,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(`Ending the trial failed (${response.status}): ${body}`);
  }
}

async function getBillingStatus(
  sessionCookie: string,
): Promise<BillingStatusPayload> {
  const response = await fetch(`${API_BASE_URL}/api/app/billing/status`, {
    headers: { Cookie: `bindersnap_session=${sessionCookie}` },
  });
  return response.json() as Promise<BillingStatusPayload>;
}

/**
 * The status the paywall answers with, probed by attempting to author.
 *
 * Reading is never gated (ADR 0004), so a GET can no longer tell us anything
 * about billing. Creating a document is gated, and `requireSubscription` runs
 * before the request body is validated — so a deliberately empty POST answers
 * 402 when the organization is blocked and 400 when it is not.
 */
async function getAuthoringHttpStatus(sessionCookie: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/api/app/documents`, {
    method: "POST",
    headers: {
      Cookie: `bindersnap_session=${sessionCookie}`,
      Origin: APP_ORIGIN,
      "Content-Type": "application/json",
    },
    body: "{}",
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

  test("a new organization authors on its trial, and is blocked once it ends", async () => {
    const credentials = uniqueCredentials();
    const { sessionCookie } = await signUpOrganization(credentials);

    // #369: fourteen days, no card. There is deliberately no Stripe customer
    // behind this, which is the whole reason the trial is a local column.
    const trialing = await getBillingStatus(sessionCookie);
    expect(trialing.hasAccess).toBe(true);
    expect(trialing.accessSource).toBe("trial");
    expect(trialing.trialEndsAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);

    await endTrial(sessionCookie);

    // And now the paywall bites, because there is nothing else granting
    // access.
    const expired = await getBillingStatus(sessionCookie);
    expect(expired.hasAccess).toBe(false);
    expect(await getAuthoringHttpStatus(sessionCookie)).toBe(402);
  });

  // -------------------------------------------------------------------------
  // 3–6. Full lifecycle — Stripe test API required
  // -------------------------------------------------------------------------

  test("checkout.session.completed activates the subscription and grants document access", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie, giteaOrgId } = await signUpOrganization(credentials);
    await endTrial(sessionCookie);

    // Pre-condition: the trial is over and nothing has been paid, so authoring
    // is blocked.
    expect(await getAuthoringHttpStatus(sessionCookie)).toBe(402);

    const { customerId, subscriptionId } =
      await createTestCustomerAndSubscription(giteaOrgId);

    try {
      const webhookResp = await postWebhook("checkout.session.completed", {
        id: `cs_test_${Date.now()}`,
        client_reference_id: String(giteaOrgId),
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
      expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.updated to past_due revokes document access", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie, giteaOrgId } = await signUpOrganization(credentials);
    await endTrial(sessionCookie);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(giteaOrgId);

    try {
      // Activate via checkout webhook
      await postWebhook("checkout.session.completed", {
        client_reference_id: String(giteaOrgId),
        customer: customerId,
        subscription: subscriptionId,
      });
      expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);

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
      expect(await getAuthoringHttpStatus(sessionCookie)).toBe(402);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.updated back to active restores access after past_due", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie, giteaOrgId } = await signUpOrganization(credentials);
    await endTrial(sessionCookie);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(giteaOrgId);

    try {
      await postWebhook("checkout.session.completed", {
        client_reference_id: String(giteaOrgId),
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
      expect(await getAuthoringHttpStatus(sessionCookie)).toBe(402);

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
      expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.updated honors items[].current_period_end on newer Stripe API shapes", async () => {
    // Regression for issue #179: Stripe API >= 2025-04-30 omits the top-level
    // current_period_end and exposes it on items.data[0]. The webhook handler
    // must read both shapes — otherwise a misconfigured webhook endpoint
    // version would silently revoke access from valid paying customers after
    // one billing cycle (the 3-day expiry guard in subscriptions.ts).
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie, giteaOrgId } = await signUpOrganization(credentials);
    await endTrial(sessionCookie);
    const { customerId, subscriptionId } =
      await createTestCustomerAndSubscription(giteaOrgId);

    try {
      // Activate first via the normal checkout webhook path.
      await postWebhook("checkout.session.completed", {
        client_reference_id: String(giteaOrgId),
        customer: customerId,
        subscription: subscriptionId,
      });
      expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);

      // Send a subscription.updated payload shaped like the new API:
      // NO top-level current_period_end; only items.data[0].current_period_end.
      const newShapePeriodEnd =
        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const updateResp = await postWebhook("customer.subscription.updated", {
        id: subscriptionId,
        customer: customerId,
        status: "active",
        items: {
          data: [
            {
              id: "si_test_new_shape",
              current_period_end: newShapePeriodEnd,
            },
          ],
        },
      });
      expect(updateResp.ok).toBe(true);

      const billing = await getBillingStatus(sessionCookie);
      expect(billing.status).toBe("active");
      // The handler must have picked up the nested period end, not the
      // (stale) one stored at activation time.
      expect(billing.currentPeriodEnd).toBe(newShapePeriodEnd);
      expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);
    } finally {
      await cancelTestSubscription(subscriptionId);
    }
  });

  test("customer.subscription.deleted marks the subscription canceled", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie, giteaOrgId } = await signUpOrganization(credentials);
    await endTrial(sessionCookie);
    const { customerId, subscriptionId, currentPeriodEnd } =
      await createTestCustomerAndSubscription(giteaOrgId);

    // Activate
    await postWebhook("checkout.session.completed", {
      client_reference_id: String(giteaOrgId),
      customer: customerId,
      subscription: subscriptionId,
    });
    expect(await getAuthoringHttpStatus(sessionCookie)).not.toBe(402);

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
    expect(await getAuthoringHttpStatus(sessionCookie)).toBe(402);
  });

  test("billing/checkout returns a Stripe Checkout Session URL", async () => {
    test.skip(!stripeFullyConfigured, "Stripe test credentials not configured");

    const credentials = uniqueCredentials();
    const { sessionCookie } = await signUpOrganization(credentials);

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
    // The whole customer journey in one test: signup with provisioning, a
    // round trip through Stripe's hosted page, the redirect back, and the
    // webhook landing before the workspace unlocks. The waits below add up to
    // more than two minutes of budget on their own.
    test.setTimeout(240_000);

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

      // A new organization starts on a 14-day trial with no card (ADR 0004,
      // #369), so signup lands in the workspace rather than at a card form.
      //
      // Wait for the workspace itself, not for the absence of /billing: a
      // negative URL assertion is satisfied the instant it is made, because
      // the page is still on /signup while the server provisions the
      // organization, its binder, three teams and the rules on `main`. That
      // would send the rest of this test to /billing with no session, where
      // the app renders the login view and no amount of waiting produces a
      // subscribe button.
      await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
      await expect(
        page.locator(
          `.app-topnav-avatar[aria-label="User: ${credentials.username}"]`,
        ),
      ).toBeVisible({ timeout: 30_000 });

      // Subscribing is now a thing the customer chooses to do, so go and do it.
      await page.goto("/billing", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: "Subscribe now" }),
      ).toBeVisible({ timeout: 20_000 });

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
