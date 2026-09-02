import { describe, expect, it } from "bun:test";

import {
  isInTrial,
  OrganizationStore,
  recordProvisionedOrganization,
  trialEndsAtFrom,
  TRIAL_DAYS,
} from "./organizations";

const TEST_DB = ":memory:";

function makeStore() {
  return new OrganizationStore(TEST_DB);
}

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("OrganizationStore", () => {
  it("round-trips an organization keyed on its Gitea org id", async () => {
    const store = makeStore();

    await store.upsert({
      giteaOrgId: 42,
      name: "mercy-health",
      createdBy: "alice",
      createdAt: 1_700_000_000,
      trialEndsAt: 1_701_000_000,
    });

    expect(await store.get(42)).toEqual({
      giteaOrgId: 42,
      name: "mercy-health",
      createdBy: "alice",
      createdAt: 1_700_000_000,
      trialEndsAt: 1_701_000_000,
    });
    expect(await store.getByName("mercy-health")).not.toBeNull();
    expect(await store.get(43)).toBeNull();
  });

  it("survives the rename that would break a name key", async () => {
    const store = makeStore();

    await store.upsert({
      giteaOrgId: 42,
      name: "mercy-health",
      createdBy: "alice",
      createdAt: 1_700_000_000,
      trialEndsAt: null,
    });
    // Gitea renames organizations. The row follows the id, not the name, which
    // is the whole reason the key moved off `username`.
    await store.upsert({
      giteaOrgId: 42,
      name: "mercy-health-system",
      createdBy: "alice",
      createdAt: 1_700_000_000,
      trialEndsAt: null,
    });

    expect((await store.get(42))?.name).toBe("mercy-health-system");
    expect(await store.getByName("mercy-health")).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });
});

describe("the local trial", () => {
  it("runs for fourteen days from signup", () => {
    expect(trialEndsAtFrom(NOW)).toBe(
      Math.floor(NOW / 1000) + TRIAL_DAYS * 24 * 60 * 60,
    );
    expect(TRIAL_DAYS).toBe(14);
  });

  it("is over when its end has passed, and absent when there is none", () => {
    const record = {
      giteaOrgId: 1,
      name: "mercy-health",
      createdBy: "alice",
      createdAt: Math.floor(NOW / 1000),
      trialEndsAt: trialEndsAtFrom(NOW),
    };

    expect(isInTrial(record, NOW + 13 * DAY_MS)).toBe(true);
    expect(isInTrial(record, NOW + 15 * DAY_MS)).toBe(false);
    expect(isInTrial({ ...record, trialEndsAt: null }, NOW)).toBe(false);
    expect(isInTrial(null, NOW)).toBe(false);
  });
});

describe("recordProvisionedOrganization", () => {
  it("starts the trial on the first run and leaves it alone after", async () => {
    const store = makeStore();

    const first = await recordProvisionedOrganization({
      giteaOrgId: 42,
      name: "mercy-health",
      createdBy: "alice",
      store,
      now: NOW,
    });

    const second = await recordProvisionedOrganization({
      giteaOrgId: 42,
      name: "mercy-health-system",
      createdBy: "bob",
      store,
      now: NOW + 10 * DAY_MS,
    });

    // Re-running provisioning must not reset the clock, or a customer could
    // renew their trial by signing up again.
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.createdBy).toBe("alice");
    // The display name does follow Gitea.
    expect(second.name).toBe("mercy-health-system");
  });
});

describe("who gets a trial", () => {
  it("gives the trial to a person's first organization only", async () => {
    const store = makeStore();

    const first = await recordProvisionedOrganization({
      giteaOrgId: 1,
      name: "mercy-health",
      createdBy: "alice",
      store,
      now: NOW,
    });
    expect(first.trialEndsAt).toBe(trialEndsAtFrom(NOW));

    // Creating organizations is self-serve, so a trial per organization is a
    // trial per afternoon for anyone willing to click twice. The second one is
    // real and allowed; it just has to be paid for.
    const second = await recordProvisionedOrganization({
      giteaOrgId: 2,
      name: "mercy-health-2",
      createdBy: "alice",
      store,
      now: NOW,
    });
    expect(second.trialEndsAt).toBeNull();
    expect(isInTrial(second, NOW)).toBe(false);
  });

  it("counts trials per person, not globally", async () => {
    const store = makeStore();

    await recordProvisionedOrganization({
      giteaOrgId: 1,
      name: "mercy-health",
      createdBy: "alice",
      store,
      now: NOW,
    });
    const bobsFirst = await recordProvisionedOrganization({
      giteaOrgId: 2,
      name: "st-jude",
      createdBy: "bob",
      store,
      now: NOW,
    });

    expect(bobsFirst.trialEndsAt).toBe(trialEndsAtFrom(NOW));
  });

  it("re-provisioning keeps the trial the organization already had", async () => {
    const store = makeStore();

    const created = await recordProvisionedOrganization({
      giteaOrgId: 1,
      name: "mercy-health",
      createdBy: "alice",
      store,
      now: NOW,
    });
    const again = await recordProvisionedOrganization({
      giteaOrgId: 1,
      name: "mercy-health",
      createdBy: "alice",
      store,
      now: NOW + 30 * DAY_MS,
    });

    expect(again.trialEndsAt).toBe(created.trialEndsAt);
  });
});
