import { randomUUID } from "node:crypto";

/**
 * A synthetic Stripe event, as `stripe/webhook` receives one.
 *
 * The id is random, not the clock: the API drops an event id it has already
 * processed, so two events built in the same millisecond used to collide and
 * the second was silently skipped as a duplicate.
 */
export function buildTestStripeEvent(
  type: string,
  object: Record<string, unknown>,
  options: { created?: number } = {},
): {
  body: string;
  event: Record<string, unknown>;
} {
  const event = {
    id: `evt_test_${randomUUID().replace(/-/g, "")}`,
    type,
    livemode: false,
    created: options.created ?? Math.floor(Date.now() / 1000),
    data: { object },
  };

  return {
    body: JSON.stringify(event),
    event,
  };
}

export async function signWebhookBody(
  body: string,
  secret: string,
): Promise<string> {
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
