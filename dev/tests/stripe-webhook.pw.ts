/**
 * Integration tests for POST /stripe/webhook against the running dev server.
 *
 * The dev server runs without STRIPE_WEBHOOK_SECRET by default, so signature
 * verification is skipped and we get 200 back. The tests also cover the case
 * where a secret is provided — but since we can't easily inject env vars into
 * an already-running server, we test the "no secret configured" path here and
 * rely on unit tests (src/stripe/webhook.test.ts) for the HMAC math.
 */

import { expect, test } from '@playwright/test';

const APP_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const WEBHOOK_URL = `${APP_BASE_URL}/stripe/webhook`;

test.describe('POST /stripe/webhook', () => {
  test('returns 財 200 for a well-formed checkout.session.completed event', async ({ request }) => {
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          customer: 'cus_test',
          customer_email: 'test@example.com',
          amount_total: 2900,
          currency: 'usd',
          payment_status: 'paid',
        },
      },
    });

    const response = await request.post(WEBHOOK_URL, {
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });

    // Without STRIPE_WEBHOOK_SECRET configured, signature check is skipped.
    expect(response.status()).toBe(200);
  });

  test('returns 200 for an unhandled event type (server logs and acks)', async ({ request }) => {
    const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } });

    const response = await request.post(WEBHOOK_URL, {
      data: body,
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status()).toBe(200);
  });

  test('returns 400 for a non-JSON body', async ({ request }) => {
    const response = await request.post(WEBHOOK_URL, {
      data: 'not-json',
      headers: { 'Content-Type': 'text/plain' },
    });

    expect(response.status()).toBe(400);
  });
});
