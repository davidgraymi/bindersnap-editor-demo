import { expect, test, mock } from "bun:test";
import {
  VISIBLE_POLLING_DELAYS_MS,
  BACKGROUND_POLL_INTERVAL_MS,
  BACKGROUND_POLL_WINDOW_MS,
  runBackgroundPoll,
} from "./BillingPage";

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
