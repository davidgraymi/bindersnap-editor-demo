import { randomUUID } from "node:crypto";

/**
 * This run's tag, which the API only acts on events carrying (see
 * services/api/stripe/run-tag.ts). Set by global-setup; empty when the stack
 * was started without one, and then the API accepts every event.
 */
export function stripeRunTag(): string {
  return (process.env.STRIPE_RUN_TAG ?? "").trim();
}

/** Metadata that marks a Stripe object as this run's, or nothing. */
export function stripeRunTagMetadata(): Record<string, string> {
  const tag = stripeRunTag();
  return tag === "" ? {} : { bindersnap_run: tag };
}

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
  // Stamped the way this run's own Stripe objects are, so the API treats the
  // event as ours rather than another CI job's.
  const tagged = {
    ...object,
    metadata: {
      ...stripeRunTagMetadata(),
      ...((object.metadata as Record<string, unknown> | undefined) ?? {}),
    },
  };
  const event = {
    id: `evt_test_${randomUUID().replace(/-/g, "")}`,
    type,
    livemode: false,
    created: options.created ?? Math.floor(Date.now() / 1000),
    data: { object: tagged },
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
