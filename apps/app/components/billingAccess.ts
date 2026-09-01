/**
 * Which billing panel a session should see.
 *
 * ADR 0004 gives every new organization a 14-day trial with no card, so
 * "has access" and "has a subscription" came apart. `subscriptionStatus` only
 * answers the first — it reads "active" throughout a trial — and access alone
 * is not enough to decide what the billing page is for.
 */

/**
 * True when there is a real Stripe subscription to show and manage.
 *
 * A trialing organization has access and no subscription, so answering true
 * for it would offer a portal for a Stripe customer that does not exist and
 * hide the only control that could create one.
 */
export function hasManageableSubscription(
  subscriptionStatus: "active" | "none" | "loading",
  accessSource: string | null,
): boolean {
  return subscriptionStatus === "active" && accessSource === "stripe";
}
