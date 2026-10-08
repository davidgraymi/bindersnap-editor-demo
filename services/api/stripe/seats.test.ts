import { describe, expect, test } from "bun:test";
import {
  createSeatSyncScheduler,
  seatAffectingOrganization,
  seatQuantity,
  syncSubscriptionSeats,
  type SeatSyncStripe,
} from "./seats";

function fakeStripe(subscription: {
  status: string;
  items: { id: string; price: string; quantity?: number }[];
}) {
  const updates: { id: string; params: Record<string, unknown> }[] = [];
  const stripe = {
    subscriptions: {
      retrieve: async () => ({
        status: subscription.status,
        items: {
          data: subscription.items.map((item) => ({
            id: item.id,
            price: { id: item.price },
            quantity: item.quantity,
          })),
        },
      }),
    },
    subscriptionItems: {
      update: async (id: string, params: Record<string, unknown>) => {
        updates.push({ id, params });
        return {};
      },
    },
  } as unknown as SeatSyncStripe;
  return { stripe, updates };
}

describe("seatQuantity", () => {
  test("is the seat count, and never below one", () => {
    expect(seatQuantity(3)).toBe(3);
    expect(seatQuantity(0)).toBe(1);
  });
});

describe("syncSubscriptionSeats", () => {
  const params = { subscriptionId: "sub_1", priceId: "price_seat" };

  test("sets the seat line to the count, prorated", async () => {
    const { stripe, updates } = fakeStripe({
      status: "active",
      items: [{ id: "si_1", price: "price_seat", quantity: 1 }],
    });
    expect(
      await syncSubscriptionSeats(stripe, { ...params, seats: 3 }),
    ).toEqual({ changed: true, from: 1, to: 3, itemId: "si_1" });
    expect(updates).toEqual([
      {
        id: "si_1",
        params: { quantity: 3, proration_behavior: "create_prorations" },
      },
    ]);
  });

  test("writes nothing when the count already matches", async () => {
    const { stripe, updates } = fakeStripe({
      status: "active",
      items: [{ id: "si_1", price: "price_seat", quantity: 2 }],
    });
    expect(
      await syncSubscriptionSeats(stripe, { ...params, seats: 2 }),
    ).toMatchObject({ changed: false, reason: "unchanged" });
    expect(updates).toEqual([]);
  });

  test("leaves a cancelled subscription alone", async () => {
    const { stripe, updates } = fakeStripe({
      status: "canceled",
      items: [{ id: "si_1", price: "price_seat", quantity: 1 }],
    });
    expect(
      await syncSubscriptionSeats(stripe, { ...params, seats: 4 }),
    ).toMatchObject({ changed: false, reason: "ended" });
    expect(updates).toEqual([]);
  });

  test("corrects the one line of a subscription on an older price", async () => {
    const { stripe, updates } = fakeStripe({
      status: "past_due",
      items: [{ id: "si_old", price: "price_flat", quantity: 1 }],
    });
    await syncSubscriptionSeats(stripe, { ...params, seats: 2 });
    expect(updates.map((update) => update.id)).toEqual(["si_old"]);
  });

  test("will not guess between several lines on other prices", async () => {
    const { stripe, updates } = fakeStripe({
      status: "active",
      items: [
        { id: "si_a", price: "price_a", quantity: 1 },
        { id: "si_b", price: "price_b", quantity: 1 },
      ],
    });
    expect(
      await syncSubscriptionSeats(stripe, { ...params, seats: 2 }),
    ).toMatchObject({ changed: false, reason: "no_item" });
    expect(updates).toEqual([]);
  });
});

describe("seatAffectingOrganization", () => {
  test("names the organization of a change to who can write", () => {
    expect(
      seatAffectingOrganization("POST", "/api/app/orgs/mercy/people"),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization("POST", "/api/app/orgs/mercy/people/ann/role"),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization("DELETE", "/api/app/orgs/mercy/people/ann"),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization(
        "DELETE",
        "/api/app/orgs/mercy/groups/nurses/members/ann",
      ),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization("POST", "/api/app/orgs/mercy/binders"),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization(
        "POST",
        "/api/app/binders/mercy/infection-control/people",
      ),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization(
        "PUT",
        "/api/app/binders/mercy/infection-control/groups/nurses",
      ),
    ).toBe("mercy");
    expect(
      seatAffectingOrganization(
        "POST",
        "/api/app/binders/mercy/infection-control/archive",
      ),
    ).toBe("mercy");
  });

  test("ignores reads, and writes that cannot change a seat", () => {
    expect(
      seatAffectingOrganization("GET", "/api/app/orgs/mercy/people"),
    ).toBeNull();
    expect(
      seatAffectingOrganization(
        "POST",
        "/api/app/binders/mercy/infection-control/name",
      ),
    ).toBeNull();
    expect(
      seatAffectingOrganization(
        "POST",
        "/api/app/binders/mercy/people-handbook/changes",
      ),
    ).toBeNull();
  });
});

describe("createSeatSyncScheduler", () => {
  test("a burst of changes is one sync", async () => {
    const runs: string[] = [];
    const scheduler = createSeatSyncScheduler({
      delayMs: 5,
      run: async (organization) => {
        runs.push(organization);
      },
    });
    scheduler.schedule("mercy");
    scheduler.schedule("Mercy");
    scheduler.schedule("mercy");
    await scheduler.idle();
    expect(runs).toEqual(["mercy"]);
  });

  test("a change during a sync gets one more pass after it", async () => {
    const runs: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    const scheduler = createSeatSyncScheduler({
      delayMs: 1,
      run: async (organization) => {
        runs.push(organization);
        if (runs.length === 1) await first;
      },
    });
    scheduler.schedule("mercy");
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.schedule("mercy");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runs).toEqual(["mercy"]);
    release();
    await scheduler.idle();
    expect(runs).toEqual(["mercy", "mercy"]);
  });

  test("a failed sync is reported, not thrown", async () => {
    const errors: string[] = [];
    const scheduler = createSeatSyncScheduler({
      delayMs: 1,
      run: async () => {
        throw new Error("Stripe is down");
      },
      onError: (organization, error) =>
        errors.push(`${organization}: ${(error as Error).message}`),
    });
    scheduler.schedule("mercy");
    await scheduler.idle();
    expect(errors).toEqual(["mercy: Stripe is down"]);
  });
});
