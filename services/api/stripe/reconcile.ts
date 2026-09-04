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

/**
 * The organization a Stripe customer belongs to.
 *
 * ADR 0004 bills the organization, so this is the identifier every Stripe
 * object carries. `bindersnap_username` is still written alongside it — it
 * records who set the subscription up, which support needs — but it is never
 * the key, because the person who signed up can leave and the org's
 * subscription must not leave with them.
 *
 * A customer created before the re-key has no org id. That is not an error to
 * paper over: `scripts/backfill-org-billing.ts` stamps it, and until it does
 * the customer is skipped rather than guessed at.
 */
export function getBindersnapOrganizationIdFromStripeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): number | null {
  if (!customer) return null;
  if ((customer as Stripe.DeletedCustomer).deleted) return null;
  const metadata = (customer as Stripe.Customer).metadata ?? null;
  const raw = metadata?.bindersnap_gitea_org_id;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const orgId = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(orgId) && orgId > 0 ? orgId : null;
}

/** Who set the subscription up. Support metadata; never a key. */
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
  giteaOrgId: number,
  customerId: string,
  subscription: StripeObjectLike,
  now = Date.now(),
): SubscriptionRecord {
  const subscriptionId = readString(subscription, "id");
  if (!subscriptionId) {
    throw new Error("Stripe subscription payload is missing id.");
  }

  return {
    giteaOrgId,
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
  const giteaOrgId = getBindersnapOrganizationIdFromStripeCustomer(customer);
  if ((customer as Stripe.DeletedCustomer).deleted || !giteaOrgId) {
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
      giteaOrgId,
      customerId,
      subscription,
      options?.now,
    ),
  };
}

export async function reconcileStripeCustomerByOrganization(
  stripe: Stripe,
  giteaOrgId: number,
  now = Date.now(),
): Promise<StripeReconciliationResult | null> {
  const search = await stripe.customers.search({
    query: `metadata['bindersnap_gitea_org_id']:'${escapeStripeSearchString(String(giteaOrgId))}'`,
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
      giteaOrgId,
      customer.id,
      subscription,
      now,
    ),
  };
}
