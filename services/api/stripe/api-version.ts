/**
 * Pinned Stripe API version for outbound requests AND for the webhook
 * endpoint configured in the Stripe Dashboard.
 *
 * We are pinned to the `2025-06-30.basil` shape, where `current_period_end`
 * lives on `subscription.items.data[0]`. The `extractCurrentPeriodEnd` helper
 * still reads both old and new shapes defensively for safety.
 *
 * WARNING: The webhook endpoint API version in the Stripe Dashboard must
 * match this constant in both test and live mode — see docs/payments-plan.md.
 */
export const STRIPE_API_VERSION = "2025-06-30.basil";

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
