import Stripe from "stripe";
import { config } from "../config";
import { STRIPE_API_VERSION } from "./api-version";

type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

let cachedClient: Stripe | null = null;
let cachedKey: string | null = null;

/**
 * Returns a singleton Stripe SDK client configured with our pinned API
 * version and the fetch-based HTTP transport (so test mocks of
 * `globalThis.fetch` still intercept outbound requests).
 *
 * The client is rebuilt automatically if `config.stripeSecretKey` changes
 * at runtime — which only happens in tests.
 */
export function getStripeClient(): Stripe {
  const key = config.stripeSecretKey;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is required.");
  }
  if (cachedClient && cachedKey === key) {
    return cachedClient;
  }
  // Pinned to STRIPE_API_VERSION (older than the SDK's bundled latest) to
  // match our webhook endpoint configuration; see stripe/api-version.ts.
  cachedClient = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION as StripeApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
  cachedKey = key;
  return cachedClient;
}

export function resetStripeClientForTests(): void {
  cachedClient = null;
  cachedKey = null;
}
