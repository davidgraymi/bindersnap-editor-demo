import { beforeEach, describe, expect, test } from "bun:test";
import { createMigratedTestDbPath } from "./db/test-helpers";
import { SubscriptionStore, type SubscriptionRecord } from "./subscriptions";

async function makeStore(): Promise<SubscriptionStore> {
  return new SubscriptionStore(
    await createMigratedTestDbPath("bindersnap-subscription-store-"),
  );
}

function makeSubscription(
  overrides: Partial<SubscriptionRecord> = {},
): SubscriptionRecord {
  return {
    username: "testuser",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    status: "active",
    currentPeriodEnd: 1_700_000_000,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("SubscriptionStore", () => {
  let store: SubscriptionStore;

  beforeEach(async () => {
    store = await makeStore();
  });

  test("upsert then getByUsername returns the subscription", () => {
    const record = makeSubscription();
    store.upsert(record);

    expect(store.getByUsername(record.username)).toEqual(record);
  });

  test("getByCustomerId returns the matching subscription", () => {
    const record = makeSubscription();
    store.upsert(record);

    expect(store.getByCustomerId(record.stripeCustomerId)).toEqual(record);
  });

  test("upsert updates an existing username record", () => {
    const initial = makeSubscription();
    const updated = makeSubscription({
      stripeCustomerId: "cus_456",
      stripeSubscriptionId: "sub_456",
      status: "past_due",
      currentPeriodEnd: null,
      updatedAt: initial.updatedAt + 1_000,
    });

    store.upsert(initial);
    store.upsert(updated);

    expect(store.getByUsername(updated.username)).toEqual(updated);
    expect(store.getByCustomerId(initial.stripeCustomerId)).toBeNull();
    expect(store.getByCustomerId(updated.stripeCustomerId)).toEqual(updated);
  });

  test("unknown lookups return null", () => {
    expect(store.getByUsername("missing-user")).toBeNull();
    expect(store.getByCustomerId("cus_missing")).toBeNull();
  });
});
