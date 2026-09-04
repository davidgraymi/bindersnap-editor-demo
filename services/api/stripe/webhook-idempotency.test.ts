import { describe, it, expect } from "bun:test";
import { OrganizationStore } from "../organizations";
import { WebhookEventStore, SubscriptionStore } from "../subscriptions";

const TEST_DB = ":memory:";

function makeWebhookStore() {
  return new WebhookEventStore(TEST_DB);
}

function makeSubStore() {
  // Billing keys to the organization (ADR 0004), so the store needs an
  // organization backend for its trial layer. No organization here has a
  // trial, so access comes only from Stripe.
  return new SubscriptionStore(TEST_DB, new OrganizationStore(TEST_DB));
}

const NOW = Math.floor(Date.now() / 1000);
const CUSTOMER = "cus_test123";

describe("WebhookEventStore — idempotency", () => {
  it("isProcessed returns false for unknown event", async () => {
    const store = makeWebhookStore();
    expect(await store.isProcessed("evt_new")).toBe(false);
  });

  it("isProcessed returns true after markProcessed", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_1",
      "checkout.session.completed",
      CUSTOMER,
      NOW,
    );
    expect(await store.isProcessed("evt_1")).toBe(true);
  });

  it("markProcessed is idempotent — second call does not throw", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_dup",
      "customer.subscription.updated",
      CUSTOMER,
      NOW,
    );
    await expect(
      store.markProcessed(
        "evt_dup",
        "customer.subscription.updated",
        CUSTOMER,
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(await store.isProcessed("evt_dup")).toBe(true);
  });

  it("different event IDs are independent", async () => {
    const store = makeWebhookStore();
    await store.markProcessed("evt_a", "invoice.payment_failed", CUSTOMER, NOW);
    expect(await store.isProcessed("evt_a")).toBe(true);
    expect(await store.isProcessed("evt_b")).toBe(false);
  });

  it("null customerId is accepted", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_no_cust",
      "checkout.session.completed",
      null,
      NOW,
    );
    expect(await store.isProcessed("evt_no_cust")).toBe(true);
  });
});

describe("WebhookEventStore — out-of-order protection", () => {
  it("isOutOfOrder returns false when no prior state for customer", async () => {
    const store = makeWebhookStore();
    expect(await store.isOutOfOrder(CUSTOMER, NOW)).toBe(false);
  });

  it("isOutOfOrder returns false when event is newer than recorded", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_first",
      "customer.subscription.updated",
      CUSTOMER,
      NOW,
    );
    expect(await store.isOutOfOrder(CUSTOMER, NOW + 1)).toBe(false);
  });

  it("isOutOfOrder returns false when event is same timestamp as recorded", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_same",
      "customer.subscription.updated",
      CUSTOMER,
      NOW,
    );
    expect(await store.isOutOfOrder(CUSTOMER, NOW)).toBe(false);
  });

  it("isOutOfOrder returns true when event is strictly older than recorded", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_newer",
      "customer.subscription.updated",
      CUSTOMER,
      NOW + 10,
    );
    expect(await store.isOutOfOrder(CUSTOMER, NOW + 5)).toBe(true);
  });

  it("last_event_created_at advances to MAX — older event does not roll it back", async () => {
    const store = makeWebhookStore();
    await store.markProcessed(
      "evt_t10",
      "customer.subscription.updated",
      CUSTOMER,
      NOW + 10,
    );
    await store.markProcessed(
      "evt_t5",
      "invoice.payment_failed",
      CUSTOMER,
      NOW + 5,
    );
    // After inserting an older event, the newer timestamp is preserved
    expect(await store.isOutOfOrder(CUSTOMER, NOW + 8)).toBe(true);
  });

  it("different customers have independent state", async () => {
    const store = makeWebhookStore();
    const cust1 = "cus_aaa";
    const cust2 = "cus_bbb";
    await store.markProcessed(
      "evt_c1",
      "customer.subscription.updated",
      cust1,
      NOW + 100,
    );
    // cust2 has no state yet
    expect(await store.isOutOfOrder(cust2, NOW)).toBe(false);
    // cust1 would reject an older event
    expect(await store.isOutOfOrder(cust1, NOW)).toBe(true);
  });
});

describe("Webhook idempotency — duplicate delivery produces single side effect", () => {
  it("processing same checkout.session.completed twice leaves one subscription record", async () => {
    const subStore = makeSubStore();
    const whStore = makeWebhookStore();
    const EVENT_ID = "evt_checkout_dup";

    async function processCheckout() {
      if (await whStore.isProcessed(EVENT_ID)) return false;
      await subStore.upsert({
        giteaOrgId: 5001,
        stripeCustomerId: CUSTOMER,
        stripeSubscriptionId: "sub_1",
        status: "active",
        currentPeriodEnd: NOW + 30 * 86400,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        updatedAt: Date.now(),
      });
      await whStore.markProcessed(
        EVENT_ID,
        "checkout.session.completed",
        CUSTOMER,
        NOW,
      );
      return true;
    }

    const first = await processCheckout();
    const second = await processCheckout();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect((await subStore.getByOrganization(5001))?.status).toBe("active");
  });
});

describe("Webhook out-of-order — past_due-after-active stays active", () => {
  it("late-arriving past_due event after active is rejected; state remains active", async () => {
    const subStore = makeSubStore();
    const whStore = makeWebhookStore();

    const T_ACTIVE = NOW + 100;
    const T_PAST_DUE = NOW + 50; // earlier timestamp — arrives second (late)

    // 1. Process the active event (arrives first, as expected)
    await subStore.upsert({
      giteaOrgId: 5002,
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: "sub_2",
      status: "active",
      currentPeriodEnd: NOW + 30 * 86400,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });
    await whStore.markProcessed(
      "evt_active",
      "customer.subscription.updated",
      CUSTOMER,
      T_ACTIVE,
    );

    // 2. Out-of-order past_due arrives — should be rejected
    const isOOO = await whStore.isOutOfOrder(CUSTOMER, T_PAST_DUE);
    expect(isOOO).toBe(true);

    if (!isOOO) {
      // Would have executed side effect (not reached in this test)
      const record = (await subStore.getByOrganization(5002))!;
      await subStore.upsert({
        ...record,
        status: "past_due",
        updatedAt: Date.now(),
      });
    }

    // State must remain active
    expect((await subStore.getByOrganization(5002))?.status).toBe("active");
  });
});

describe("Webhook cancel_at_period_end — persisted and reflected in record", () => {
  it("subscription.updated with cancel_at_period_end=true persists fields", async () => {
    const subStore = makeSubStore();
    const CANCEL_AT = NOW + 30 * 86400;

    await subStore.upsert({
      giteaOrgId: 5003,
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: "sub_cancel",
      status: "active",
      currentPeriodEnd: CANCEL_AT,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    // Simulate webhook handler updating with cancel_at_period_end=true
    const record = (await subStore.getByCustomerId(CUSTOMER))!;
    await subStore.upsert({
      ...record,
      cancelAtPeriodEnd: true,
      cancelAt: CANCEL_AT,
      updatedAt: Date.now(),
    });

    const updated = await subStore.getByOrganization(5003);
    expect(updated?.cancelAtPeriodEnd).toBe(true);
    expect(updated?.cancelAt).toBe(CANCEL_AT);
    expect(updated?.status).toBe("active");
  });

  it("subscription.updated clearing cancel_at_period_end resets fields", async () => {
    const subStore = makeSubStore();
    const CANCEL_AT = NOW + 30 * 86400;

    await subStore.upsert({
      giteaOrgId: 5004,
      stripeCustomerId: "cus_evan",
      stripeSubscriptionId: "sub_evan",
      status: "active",
      currentPeriodEnd: CANCEL_AT,
      cancelAtPeriodEnd: true,
      cancelAt: CANCEL_AT,
      updatedAt: Date.now(),
    });

    const record = (await subStore.getByCustomerId("cus_evan"))!;
    await subStore.upsert({
      ...record,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: Date.now(),
    });

    const updated = await subStore.getByOrganization(5004);
    expect(updated?.cancelAtPeriodEnd).toBe(false);
    expect(updated?.cancelAt).toBeNull();
  });
});
