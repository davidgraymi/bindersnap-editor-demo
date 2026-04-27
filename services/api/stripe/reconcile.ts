import type { SubscriptionRecord } from "../subscriptions";
import { extractCurrentPeriodEnd } from "./api-version";

type StripeObject = Record<string, unknown>;

export type StripeFetch = (
  path: string,
  body?: URLSearchParams,
  extraHeaders?: Record<string, string>,
) => Promise<Response>;

export interface StripeReconciliationResult {
  customer: StripeObject;
  subscription: StripeObject;
  record: SubscriptionRecord;
}

function readStripeObject(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StripeObject)
    : null;
}

function readString(
  object: StripeObject | null | undefined,
  key: string,
): string | null {
  const value = object?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readStripeArray(
  object: StripeObject | null | undefined,
  key: string,
): StripeObject[] {
  const value = object?.[key];
  return Array.isArray(value)
    ? value
        .map((entry) => readStripeObject(entry))
        .filter((entry): entry is StripeObject => entry !== null)
    : [];
}

function getStripeErrorMessage(payload: StripeObject | null): string | null {
  const error = readStripeObject(payload?.error);
  return readString(error, "message");
}

async function parseStripeJson(
  response: Response,
  path: string,
): Promise<StripeObject> {
  const payload = readStripeObject(await response.json().catch(() => null));
  if (!response.ok) {
    const message =
      getStripeErrorMessage(payload) ??
      `Stripe request failed with status ${response.status}.`;
    throw new Error(
      `Stripe GET ${path} failed (${response.status}): ${message}`,
    );
  }

  return payload ?? {};
}

function escapeStripeSearchString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function fetchStripeCustomer(
  stripeFetch: StripeFetch,
  customerId: string,
): Promise<StripeObject | null> {
  const customer = await parseStripeJson(
    await stripeFetch(`/v1/customers/${encodeURIComponent(customerId)}`),
    `/v1/customers/${customerId}`,
  );

  return readString(customer, "id") ? customer : null;
}

async function fetchStripeCustomerByUsername(
  stripeFetch: StripeFetch,
  username: string,
): Promise<StripeObject | null> {
  const query = encodeURIComponent(
    `metadata['bindersnap_username']:'${escapeStripeSearchString(username)}'`,
  );
  const payload = await parseStripeJson(
    await stripeFetch(`/v1/customers/search?query=${query}&limit=1`),
    `/v1/customers/search?query=${query}&limit=1`,
  );

  return readStripeArray(payload, "data")[0] ?? null;
}

async function fetchLatestStripeSubscription(
  stripeFetch: StripeFetch,
  customerId: string,
): Promise<StripeObject | null> {
  const path = `/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=1`;
  const payload = await parseStripeJson(await stripeFetch(path), path);
  return readStripeArray(payload, "data")[0] ?? null;
}

export function getBindersnapUsernameFromStripeCustomer(
  customer: StripeObject | null | undefined,
): string | null {
  const metadata = readStripeObject(customer?.metadata);
  return readString(metadata, "bindersnap_username");
}

export function buildStripeSubscriptionRecord(
  username: string,
  customerId: string,
  subscription: StripeObject,
  now = Date.now(),
): SubscriptionRecord {
  const subscriptionId = readString(subscription, "id");
  if (!subscriptionId) {
    throw new Error("Stripe subscription payload is missing id.");
  }

  return {
    username,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status: readString(subscription, "status") ?? "active",
    currentPeriodEnd:
      extractCurrentPeriodEnd(subscription) ??
      (typeof subscription.trial_end === "number"
        ? subscription.trial_end
        : null),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    cancelAt:
      typeof subscription.cancel_at === "number"
        ? subscription.cancel_at
        : null,
    updatedAt: now,
  };
}

export async function reconcileStripeCustomerByCustomerId(
  stripeFetch: StripeFetch,
  customerId: string,
  options?: {
    subscription?: StripeObject | null;
    now?: number;
  },
): Promise<StripeReconciliationResult | null> {
  const customer = await fetchStripeCustomer(stripeFetch, customerId);
  const username = getBindersnapUsernameFromStripeCustomer(customer);
  if (!customer || !username) {
    return null;
  }

  const subscription =
    options?.subscription ??
    (await fetchLatestStripeSubscription(stripeFetch, customerId));
  if (!subscription) {
    return null;
  }

  return {
    customer,
    subscription,
    record: buildStripeSubscriptionRecord(
      username,
      customerId,
      subscription,
      options?.now,
    ),
  };
}

export async function reconcileStripeCustomerByUsername(
  stripeFetch: StripeFetch,
  username: string,
  now = Date.now(),
): Promise<StripeReconciliationResult | null> {
  const customer = await fetchStripeCustomerByUsername(stripeFetch, username);
  const customerId = readString(customer, "id");
  if (!customer || !customerId) {
    return null;
  }

  const subscription = await fetchLatestStripeSubscription(
    stripeFetch,
    customerId,
  );
  if (!subscription) {
    return null;
  }

  return {
    customer,
    subscription,
    record: buildStripeSubscriptionRecord(
      username,
      customerId,
      subscription,
      now,
    ),
  };
}
