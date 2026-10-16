import { describe, expect, test } from "bun:test";

import { describePersonGroups, describeSeats } from "./OrganizationPeople";

describe("describePersonGroups", () => {
  test("says so when a person is in no group", () => {
    expect(describePersonGroups([])).toBe("In no group yet");
  });

  test("names up to three groups", () => {
    expect(describePersonGroups(["legal", "quality-committee"])).toBe(
      "Legal · Quality Committee",
    );
  });

  test("counts the rest past three, in the singular for one", () => {
    expect(describePersonGroups(["a", "b", "c", "d"])).toMatch(
      / and 1 more group$/,
    );
    expect(describePersonGroups(["a", "b", "c", "d", "e"])).toMatch(
      / and 2 more groups$/,
    );
  });
});

describe("describeSeats", () => {
  const plan = {
    amount: 39,
    currency: "usd",
    interval: "month",
    formatted: "$39.00 / month",
  };

  test("says the paid seats and what they cost, before a role changes", () => {
    expect(describeSeats({ plan, seats: 3 })).toEqual({
      summary: "3 writers today: $117 / month.",
      unit: "$39 per writer / month",
    });
  });

  test("counts seats without a price when the plan is unknown", () => {
    expect(describeSeats({ plan: null, seats: 1 })).toEqual({
      summary: "1 paid seat today.",
      unit: null,
    });
  });

  test("says nothing when billing could not be read", () => {
    expect(describeSeats(undefined)).toBeNull();
    expect(describeSeats({ plan, seats: null })).toBeNull();
  });
});
