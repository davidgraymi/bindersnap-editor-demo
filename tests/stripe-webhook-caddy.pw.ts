import { expect, test } from "@playwright/test";

import { resolveStripeWebhookSecret } from "./stripe-runtime";
import { buildTestStripeEvent, signWebhookBody } from "./stripe-webhook";

const WEBHOOK_PROXY_BASE_URL =
  process.env.WEBHOOK_PROXY_BASE_URL ??
  `http://localhost:${process.env.API_PROXY_PORT ?? "8788"}`;
const STRIPE_WEBHOOK_SECRET = resolveStripeWebhookSecret();

test.describe("Stripe webhook via Caddy", () => {
  test("accepts a signed webhook through the local Caddy proxy", async () => {
    test.skip(
      STRIPE_WEBHOOK_SECRET === "",
      "No webhook secret available for this run.",
    );

    const { body } = buildTestStripeEvent("invoice.payment_failed", {
      id: `in_caddy_${Date.now()}`,
      object: "invoice",
      customer: `cus_caddy_${Date.now()}`,
    });
    const signature = await signWebhookBody(body, STRIPE_WEBHOOK_SECRET);

    const response = await fetch(`${WEBHOOK_PROXY_BASE_URL}/stripe/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body,
    });
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(JSON.parse(responseText)).toEqual({ received: true });
  });
});
