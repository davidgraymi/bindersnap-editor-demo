import { describe, expect, it } from "bun:test";

import { STRIPE_API_VERSION, extractCurrentPeriodEnd } from "./api-version";

describe("STRIPE_API_VERSION", () => {
  it("is pinned to 2024-06-20", () => {
    // If this changes, update the webhook endpoint API version in the Stripe
    // Dashboard (test + live) AND docs/payments-plan.md in the same change.
    expect(STRIPE_API_VERSION).toBe("2024-06-20");
  });
});

describe("extractCurrentPeriodEnd", () => {
  it("reads top-level current_period_end on legacy/pinned API shapes", () => {
    expect(extractCurrentPeriodEnd({ current_period_end: 1_700_000_000 })).toBe(
      1_700_000_000,
    );
  });

  it("falls back to items.data[0].current_period_end on newer API shapes", () => {
    // Stripe API >= 2025-04-30: field moved off Subscription onto items.
    const newShape = {
      id: "sub_test",
      status: "active",
      items: {
        data: [{ current_period_end: 1_800_000_000, id: "si_test" }],
      },
    };
    expect(extractCurrentPeriodEnd(newShape)).toBe(1_800_000_000);
  });

  it("prefers top-level field when both are present", () => {
    const data = {
      current_period_end: 1_700_000_000,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    };
    expect(extractCurrentPeriodEnd(data)).toBe(1_700_000_000);
  });

  it("returns null when neither field is set", () => {
    expect(extractCurrentPeriodEnd({ status: "trialing" })).toBeNull();
    expect(extractCurrentPeriodEnd({ items: { data: [] } })).toBeNull();
    expect(extractCurrentPeriodEnd(null)).toBeNull();
    expect(extractCurrentPeriodEnd(undefined)).toBeNull();
  });

  it("ignores non-numeric values", () => {
    expect(
      extractCurrentPeriodEnd({ current_period_end: "1700000000" as unknown }),
    ).toBeNull();
  });
});
