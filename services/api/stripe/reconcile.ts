import type Stripe from "stripe";
import type { SubscriptionRecord } from "../subscriptions";
import { extractCurrentPeriodEnd } from "./api-version";

type StripeObjectLike = Record<string, unknown>;

export interface StripeReconciliationResult {
  customer: Stripe.Customer;
  subscription: StripeObjectLike;
  record: SubscriptionRecord;
}

function readString(
  object: StripeObjectLike | null | undefined,
  key: string,
): string | null {
  const value = object?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function getBindersnapUsernameFromStripeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  if ((customer as Stripe.DeletedCustomer).deleted) return null;
  const metadata = (customer as Stripe.Customer).metadata ?? null;
  const username = metadata?.bindersnap_username;
  return typeof username === "string" && username.trim() !== ""
    ? username
    : null;
}

export function buildStripeSubscriptionRecord(
  username: string,
  customerId: string,
  subscription: StripeObjectLike,
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

function escapeStripeSearchString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function fetchLatestSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<StripeObjectLike | null> {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 1,
  });
  const first = list.data[0];
  return first ? (first as unknown as StripeObjectLike) : null;
}

export async function reconcileStripeCustomerByCustomerId(
  stripe: Stripe,
  customerId: string,
  options?: {
    subscription?: StripeObjectLike | null;
    now?: number;
  },
): Promise<StripeReconciliationResult | null> {
  const customer = await stripe.customers.retrieve(customerId);
  const username = getBindersnapUsernameFromStripeCustomer(customer);
  if ((customer as Stripe.DeletedCustomer).deleted || !username) {
    return null;
  }

  const subscription =
    options?.subscription ??
    (await fetchLatestSubscription(stripe, customerId));
  if (!subscription) {
    return null;
  }

  return {
    customer: customer as Stripe.Customer,
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
  stripe: Stripe,
  username: string,
  now = Date.now(),
): Promise<StripeReconciliationResult | null> {
  const search = await stripe.customers.search({
    query: `metadata['bindersnap_username']:'${escapeStripeSearchString(username)}'`,
    limit: 1,
  });
  const customer = search.data[0];
  if (!customer) return null;

  const subscription = await fetchLatestSubscription(stripe, customer.id);
  if (!subscription) return null;

  return {
    customer,
    subscription,
    record: buildStripeSubscriptionRecord(
      username,
      customer.id,
      subscription,
      now,
    ),
  };
}
