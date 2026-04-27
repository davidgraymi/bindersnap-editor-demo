import { describe, it, expect } from "bun:test";
import { WebhookEventStore, SubscriptionStore } from "../subscriptions";

const TEST_DB = ":memory:";

function makeWebhookStore() {
  return new WebhookEventStore(TEST_DB);
}

function makeSubStore() {
  return new SubscriptionStore(TEST_DB);
}

const NOW = Math.floor(Date.now() / 1000);
const CUSTOMER = "cus_test123";

describe("WebhookEventStore — idempotency", () => {
  it("isProcessed returns false for unknown event", () => {
    const store = makeWebhookStore();
    expect(store.isProcessed("evt_new")).toBe(false);
  });

  it("isProcessed returns true after markProcessed", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_1", "checkout.session.completed", CUSTOMER, NOW);
    expect(store.isProcessed("evt_1")).toBe(true);
  });

  it("markProcessed is idempotent — second call does not throw", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_dup", "customer.subscription.updated", CUSTOMER, NOW);
    expect(() =>
      store.markProcessed("evt_dup", "customer.subscription.updated", CUSTOMER, NOW),
    ).not.toThrow();
    expect(store.isProcessed("evt_dup")).toBe(true);
  });

  it("different event IDs are independent", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_a", "invoice.payment_failed", CUSTOMER, NOW);
    expect(store.isProcessed("evt_a")).toBe(true);
    expect(store.isProcessed("evt_b")).toBe(false);
  });

  it("null customerId is accepted", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_no_cust", "checkout.session.completed", null, NOW);
    expect(store.isProcessed("evt_no_cust")).toBe(true);
  });
});

describe("WebhookEventStore — out-of-order protection", () => {
  it("isOutOfOrder returns false when no prior state for customer", () => {
    const store = makeWebhookStore();
    expect(store.isOutOfOrder(CUSTOMER, NOW)).toBe(false);
  });

  it("isOutOfOrder returns false when event is newer than recorded", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_first", "customer.subscription.updated", CUSTOMER, NOW);
    expect(store.isOutOfOrder(CUSTOMER, NOW + 1)).toBe(false);
  });

  it("isOutOfOrder returns false when event is same timestamp as recorded", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_same", "customer.subscription.updated", CUSTOMER, NOW);
    expect(store.isOutOfOrder(CUSTOMER, NOW)).toBe(false);
  });

  it("isOutOfOrder returns true when event is strictly older than recorded", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_newer", "customer.subscription.updated", CUSTOMER, NOW + 10);
    expect(store.isOutOfOrder(CUSTOMER, NOW + 5)).toBe(true);
  });

  it("last_event_created_at advances to MAX — older event does not roll it back", () => {
    const store = makeWebhookStore();
    store.markProcessed("evt_t10", "customer.subscription.updated", CUSTOMER, NOW + 10);
    store.markProcessed("evt_t5", "invoice.payment_failed", CUSTOMER, NOW + 5);
    // After inserting an older event, the newer timestamp is preserved
    expect(store.isOutOfOrder(CUSTOMER, NOW + 8)).toBe(true);
  });

  it("different customers have independent state", () => {
    const store = makeWebhookStore();
    const cust1 = "cus_aaa";
    const cust2 = "cus_bbb";
    store.markProcessed("evt_c1", "customer.subscription.updated", cust1, NOW + 100);
    // cust2 has no state yet
    expect(store.isOutOfOrder(cust2, NOW)).toBe(false);
    // cust1 would reject an older event
    expect(store.isOutOfOrder(cust1, NOW)).toBe(true);
  });
});

describe("Webhook idempotency — duplicate delivery produces single side effect", () => {
  it("processing same checkout.session.completed twice leaves one subscription record", () => {
    const subStore = makeSubStore();
    const whStore = makeWebhookStore();
    const EVENT_ID = "evt_checkout_dup";

    function processCheckout() {
      if (whStore.isProcessed(EVENT_ID)) return false;
      subStore.upsert({
        username: "alice",
        stripeCustomerId: CUSTOMER,
        stripeSubscriptionId: "sub_1",
        status: "active",
        currentPeriodEnd: NOW + 30 * 86400,
        updatedAt: Date.now(),
      });
      whStore.markProcessed(EVENT_ID, "checkout.session.completed", CUSTOMER, NOW);
      return true;
    }

    const first = processCheckout();
    const second = processCheckout();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(subStore.getByUsername("alice")?.status).toBe("active");
  });
});

describe("Webhook out-of-order — past_due-after-active stays active", () => {
  it("late-arriving past_due event after active is rejected; state remains active", () => {
    const subStore = makeSubStore();
    const whStore = makeWebhookStore();

    const T_ACTIVE = NOW + 100;
    const T_PAST_DUE = NOW + 50; // earlier timestamp — arrives second (late)

    // 1. Process the active event (arrives first, as expected)
    subStore.upsert({
      username: "bob",
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: "sub_2",
      status: "active",
      currentPeriodEnd: NOW + 30 * 86400,
      updatedAt: Date.now(),
    });
    whStore.markProcessed(
      "evt_active",
      "customer.subscription.updated",
      CUSTOMER,
      T_ACTIVE,
    );

    // 2. Out-of-order past_due arrives — should be rejected
    const isOOO = whStore.isOutOfOrder(CUSTOMER, T_PAST_DUE);
    expect(isOOO).toBe(true);

    if (!isOOO) {
      // Would have executed side effect (not reached in this test)
      const record = subStore.getByUsername("bob")!;
      subStore.upsert({ ...record, status: "past_due", updatedAt: Date.now() });
    }

    // State must remain active
    expect(subStore.getByUsername("bob")?.status).toBe("active");
  });
});
