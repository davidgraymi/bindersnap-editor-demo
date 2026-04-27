/**
 * Pinned Stripe API version for outbound requests AND for the webhook
 * endpoint configured in the Stripe Dashboard.
 *
 * Why pinned: API versions >= 2025-04-30 moved `current_period_end` and
 * `current_period_start` off `Subscription` and onto
 * `subscription.items.data[0]`. A drift between this constant and the
 * webhook endpoint's configured version would silently revoke access for
 * paying customers after one billing cycle (see issue #179).
 *
 * The webhook endpoint API version must be set to this value in both
 * test and live mode — see docs/payments-plan.md.
 */
export const STRIPE_API_VERSION = "2024-06-20";

/**
 * Read `current_period_end` from a Stripe Subscription (or
 * checkout.session.completed → fetched Subscription) payload, falling
 * back to `items.data[0].current_period_end` for newer API versions
 * where the field moved.
 */
export function extractCurrentPeriodEnd(
  data: Record<string, unknown> | null | undefined,
): number | null {
  if (!data) return null;
  if (typeof data.current_period_end === "number") {
    return data.current_period_end;
  }
  const items = data.items as Record<string, unknown> | undefined;
  const itemsData = items?.data as Array<Record<string, unknown>> | undefined;
  const first = itemsData?.[0];
  if (first && typeof first.current_period_end === "number") {
    return first.current_period_end;
  }
  return null;
}
