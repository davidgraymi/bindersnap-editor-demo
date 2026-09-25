import { expect, test, mock } from "bun:test";
import { describeBilling, hasManageableSubscription } from "./billingAccess";
import {
  VISIBLE_POLLING_DELAYS_MS,
  BACKGROUND_POLL_INTERVAL_MS,
  BACKGROUND_POLL_WINDOW_MS,
  runBackgroundPoll,
} from "./checkoutPolling";

test("visible polling schedule has 10 entries", () => {
  expect(VISIBLE_POLLING_DELAYS_MS.length).toBe(10);
});

test("visible polling schedule starts at 1s and caps at 8s", () => {
  expect(VISIBLE_POLLING_DELAYS_MS[0]).toBe(1000);
  expect(VISIBLE_POLLING_DELAYS_MS[VISIBLE_POLLING_DELAYS_MS.length - 1]).toBe(
    8000,
  );
  expect(Math.max(...VISIBLE_POLLING_DELAYS_MS)).toBe(8000);
});

test("visible polling schedule total is ~63s", () => {
  const total = VISIBLE_POLLING_DELAYS_MS.reduce(
    (sum, delay) => sum + delay,
    0,
  );
  expect(total).toBe(63000);
});

test("background polling interval is 8s", () => {
  expect(BACKGROUND_POLL_INTERVAL_MS).toBe(8000);
});

test("background polling window is 5 minutes", () => {
  expect(BACKGROUND_POLL_WINDOW_MS).toBe(300000);
});

test("long-tail path: visible phase exhausted then background activation triggers callback", async () => {
  let callCount = 0;
  const mockFetch = mock(() => {
    callCount++;
    if (callCount <= 10) {
      return Promise.resolve({ status: "none" });
    }
    return Promise.resolve({ status: "active" });
  });

  let confirmedCalled = false;
  const mockOnConfirmed = mock(() => {
    confirmedCalled = true;
  });

  await runBackgroundPoll(mockFetch, mockOnConfirmed, 10, 1000);

  expect(confirmedCalled).toBe(true);
  expect(callCount).toBeGreaterThanOrEqual(11);
  expect(mockFetch).toHaveBeenCalled();
  expect(mockOnConfirmed).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Which panel the page shows
// ---------------------------------------------------------------------------

test("a trialing organization has no subscription to manage", () => {
  // The trial grants access, so subscriptionStatus reads "active" — but there
  // is nothing behind it. Treating that as a subscription sends someone who
  // has never paid to a Stripe portal for a customer that does not exist, and
  // hides "Subscribe now" on the only page where they could become a paying
  // customer.
  expect(hasManageableSubscription("active", "trial")).toBe(false);
});

test("only Stripe-backed access is a subscription", () => {
  expect(hasManageableSubscription("active", "stripe")).toBe(true);
  expect(hasManageableSubscription("active", "admin_grant")).toBe(false);
  expect(hasManageableSubscription("active", null)).toBe(false);
  expect(hasManageableSubscription("none", "stripe")).toBe(false);
  expect(hasManageableSubscription("loading", "stripe")).toBe(false);
});

// ---------------------------------------------------------------------------
// What the page says
// ---------------------------------------------------------------------------

const base = {
  subscriptionStatus: "active" as const,
  accessSource: "stripe",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  trialEndsAt: null,
};

test("a paying organization is told when it renews, and can manage it", () => {
  const summary = describeBilling({
    ...base,
    currentPeriodEnd: Date.UTC(2026, 9, 9, 12) / 1000,
  });
  expect(summary.standing).toBe("Active");
  expect(summary.detail).toBe("Renews on Oct 9, 2026.");
  expect(summary.action).toBe("manage");
});

test("a trial says when it ends and offers to subscribe", () => {
  const summary = describeBilling({
    ...base,
    accessSource: "trial",
    trialEndsAt: Date.UTC(2026, 9, 9, 12) / 1000,
  });
  expect(summary.standing).toBe("Trial");
  expect(summary.detail).toContain("Free trial until Oct 9, 2026.");
  expect(summary.action).toBe("subscribe");
});

test("complimentary access is not asked to subscribe", () => {
  // It used to be: every state that was not a Stripe subscription got
  // "Start your subscription", including a grant with nothing to pay.
  for (const accessSource of ["admin_grant", "config_bypass"]) {
    const summary = describeBilling({ ...base, accessSource });
    expect(summary.standing).toBe("Complimentary");
    expect(summary.action).toBeNull();
  }
});

test("a lapsed organization is read-only and can subscribe", () => {
  const summary = describeBilling({
    ...base,
    subscriptionStatus: "none",
    accessSource: "none",
  });
  expect(summary.standing).toBe("Inactive");
  expect(summary.action).toBe("subscribe");
});
