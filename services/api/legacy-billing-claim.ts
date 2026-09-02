import { eq } from "drizzle-orm";

import { openSqliteDb, type SqliteDb } from "./db/client";
import {
  legacyUsernameSubscriptionAccessOverrides,
  legacyUsernameSubscriptions,
} from "./db/schema";
import { config } from "./config";
import { logger } from "./logger";
import {
  subscriptionStore,
  type SubscriptionBackend,
  type SubscriptionAccessOverrideValue,
} from "./subscriptions";

/**
 * The half of the billing migration that a person completes by using the app.
 *
 * `0002_bill_the_organization` parked every username-keyed row in a legacy
 * table, because mapping a username to an organization needs Gitea and SQL
 * cannot reach it. `scripts/backfill-org-billing.ts` does that mapping for
 * accounts an operator runs it against. This does the same mapping for the
 * account standing in front of us, at the moment it first acquires an
 * organization — which is the only moment the mapping becomes knowable
 * without guessing.
 *
 * Without it, a customer who has been paying us signs up an organization and
 * lands on a trial: their subscription is still parked under their username,
 * the organization has none, and Stripe keeps billing them for a plan the
 * product no longer believes they have. That failure is silent, which is what
 * makes it worse than a lockout.
 *
 * Discipline is the backfill's: never delete a legacy row (dropping those
 * tables stays a separate, deliberate act), never overwrite billing an
 * organization already has, and be safe to run twice.
 */

export interface LegacyClaim {
  claimedSubscription: boolean;
  claimedOverride: boolean;
}

export interface ClaimLegacyBillingParams {
  username: string;
  giteaOrgId: number;
  /** Injectable for tests. */
  db?: SqliteDb;
  store?: SubscriptionBackend;
  now?: number;
}

export async function claimLegacyBillingForOrganization(
  params: ClaimLegacyBillingParams,
): Promise<LegacyClaim> {
  const db = params.db ?? openSqliteDb(config.sessionsDbPath);
  const store = params.store ?? subscriptionStore;
  const now = params.now ?? Date.now();

  const claim: LegacyClaim = {
    claimedSubscription: false,
    claimedOverride: false,
  };

  const legacySubscription = db
    .select()
    .from(legacyUsernameSubscriptions)
    .where(eq(legacyUsernameSubscriptions.username, params.username))
    .get();

  if (legacySubscription) {
    // An organization that already has billing keeps it. Re-running this, or
    // running it for someone who has since subscribed properly, must not
    // rewrite the live row from a stale parked one.
    const existing = await store.getByOrganization(params.giteaOrgId);
    if (!existing) {
      await store.upsert({
        giteaOrgId: params.giteaOrgId,
        stripeCustomerId: legacySubscription.stripeCustomerId,
        stripeSubscriptionId: legacySubscription.stripeSubscriptionId,
        status: legacySubscription.status,
        currentPeriodEnd: legacySubscription.currentPeriodEnd,
        cancelAtPeriodEnd: legacySubscription.cancelAtPeriodEnd,
        cancelAt: legacySubscription.cancelAt,
        updatedAt: Math.floor(now / 1000),
      });
      claim.claimedSubscription = true;
    }
  }

  const legacyOverride = db
    .select()
    .from(legacyUsernameSubscriptionAccessOverrides)
    .where(
      eq(legacyUsernameSubscriptionAccessOverrides.username, params.username),
    )
    .get();

  if (legacyOverride) {
    const existing = await store.getAccessOverride(params.giteaOrgId);
    if (!existing) {
      await store.putAccessOverride({
        giteaOrgId: params.giteaOrgId,
        access: legacyOverride.access as SubscriptionAccessOverrideValue,
        reason: legacyOverride.reason,
        updatedBy: legacyOverride.updatedBy,
        updatedAt: Math.floor(now / 1000),
      });
      claim.claimedOverride = true;
    }
  }

  if (claim.claimedSubscription || claim.claimedOverride) {
    logger.info("Claimed parked billing onto a new organization", {
      username: params.username,
      giteaOrgId: params.giteaOrgId,
      ...claim,
    });
  }

  return claim;
}
