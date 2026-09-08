import { expect, test } from "bun:test";
import { describeReadOnly, resolveReadOnly } from "./readOnly";

const base = {
  isSignedIn: true,
  subscriptionStatus: "none" as const,
  accessSource: "stripe" as string | null,
  hasBillingStatusError: false,
  organizationName: "riverside-health" as string | null,
};

test("a delinquent organization is read-only, and it is named", () => {
  expect(resolveReadOnly(base)).toEqual({
    readOnly: true,
    organizationName: "riverside-health",
  });
});

test("an organization with access is not read-only", () => {
  expect(
    resolveReadOnly({ ...base, subscriptionStatus: "active" }).readOnly,
  ).toBe(false);
});

test("a trial reads as active, so it is not read-only", () => {
  // The trial is a local column rather than a Stripe subscription, and
  // `resolveSubscriptionStatus` folds it to "active". Getting this wrong
  // would put every new customer into read-only for their first fortnight.
  expect(
    resolveReadOnly({
      ...base,
      subscriptionStatus: "active",
      accessSource: "trial",
    }).readOnly,
  ).toBe(false);
});

test("a session with no organization is not read-only", () => {
  // Nothing has lapsed and there is nothing to buy. Authoring asks for an
  // organization instead, which is a different screen and a different answer.
  expect(
    resolveReadOnly({ ...base, accessSource: "no_organization" }).readOnly,
  ).toBe(false);
});

test("failing to check billing is not evidence of delinquency", () => {
  // Refusing to draw a paying customer's controls because Stripe was briefly
  // unreachable is the worse failure, and it is not a risk: the API is the
  // gate, and its typed 402 turns read-only on for real.
  expect(
    resolveReadOnly({ ...base, hasBillingStatusError: true }).readOnly,
  ).toBe(false);
});

test("a signed-out visitor is not read-only", () => {
  expect(resolveReadOnly({ ...base, isSignedIn: false }).readOnly).toBe(false);
});

test("still loading is not read-only", () => {
  expect(
    resolveReadOnly({ ...base, subscriptionStatus: "loading" }).readOnly,
  ).toBe(false);
});

test("the banner leads with what still works", () => {
  const message = describeReadOnly({
    readOnly: true,
    organizationName: "riverside-health",
  });

  expect(message).toContain("riverside-health");
  expect(message).toContain("readable");
  // ADR 0004: reads and exports stay open forever. A customer who reads this
  // must not conclude their approval history is gone.
  expect(message).toContain("nothing has been taken away");
});

test("an unnamed organization still gets a sentence", () => {
  expect(
    describeReadOnly({ readOnly: true, organizationName: null }),
  ).toContain("This organization's subscription");
});
