import { expect, test } from "bun:test";
import { describePlanPrice } from "./PlanOffer";

const plan = {
  amount: 39,
  currency: "USD",
  interval: "month",
  formatted: "$39.00 / month",
};

test("the price is per writer, as the pricing page says it", () => {
  expect(describePlanPrice(plan)).toEqual({
    unit: "$39 per writer / month",
    total: null,
  });
});

test("with the seat count known, it says what that comes to", () => {
  expect(describePlanPrice({ ...plan, seats: 3 }).total).toBe(
    "3 writers today: $117 / month",
  );
  expect(describePlanPrice({ ...plan, seats: 1 }).total).toBe(
    "1 writer today: $39 / month",
  );
});

test("an organization with no writers yet is billed for one", () => {
  expect(describePlanPrice({ ...plan, seats: 0 }).total).toBe(
    "1 writer today: $39 / month",
  );
});
