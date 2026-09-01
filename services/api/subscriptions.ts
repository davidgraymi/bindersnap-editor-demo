import { asc, count, desc, eq, gt, sql } from "drizzle-orm";
import { union } from "drizzle-orm/sqlite-core";
import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import {
  processedWebhookEvents,
  subscriptionAccessOverrides,
  subscriptions,
  webhookCustomerState,
} from "./db/schema";
import { logger } from "./logger";
import {
  isInTrial,
  organizationStore,
  type OrganizationBackend,
} from "./organizations";

/**
 * We bill the organization, never a person (ADR 0004). Every function here
 * takes a Gitea org id: subscriptions, admin overrides and the trial all hang
 * off the organization, so "who owes us money" survives the person who signed
 * up leaving.
 */

export interface SubscriptionRecord {
  giteaOrgId: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string; // 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodEnd: number | null; // Unix seconds
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null; // Unix seconds
  updatedAt: number;
}

export type SubscriptionAccessOverrideValue = "grant" | "revoke";

export interface SubscriptionAccessOverrideRecord {
  giteaOrgId: number;
  access: SubscriptionAccessOverrideValue;
  reason: string | null;
  updatedBy: string;
  updatedAt: number;
}

export interface EffectiveSubscriptionAccess {
  giteaOrgId: number;
  hasAccess: boolean;
  source: "stripe" | "trial" | "admin_grant" | "admin_revoke" | "none";
  subscription: SubscriptionRecord | null;
  override: SubscriptionAccessOverrideRecord | null;
  /** When the local trial ends, if one is what is granting access. */
  trialEndsAt: number | null;
}

function hasStripeBackedAccess(record: SubscriptionRecord | null): boolean {
  if (!record) return false;
  if (record.status !== "active" && record.status !== "trialing") return false;
  // If currentPeriodEnd is known and more than 3 days past, treat as expired.
  // This is defense-in-depth against missed/failed webhook delivery.
  if (record.currentPeriodEnd !== null) {
    const bufferSeconds = 3 * 24 * 60 * 60;
    if (
      record.currentPeriodEnd + bufferSeconds <
      Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
  }
  return true;
}

// Interface for the Stripe-bound subscription + admin override store.
// SQLite on the EBS data volume; async so callers never assume a sync
// backend.
export interface SubscriptionBackend {
  getByOrganization(giteaOrgId: number): Promise<SubscriptionRecord | null>;
  getByCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
  upsert(record: SubscriptionRecord): Promise<void>;
  getAccessOverride(
    giteaOrgId: number,
  ): Promise<SubscriptionAccessOverrideRecord | null>;
  putAccessOverride(record: SubscriptionAccessOverrideRecord): Promise<void>;
  deleteAccessOverride(giteaOrgId: number): Promise<void>;
  resolveAccess(giteaOrgId: number): Promise<EffectiveSubscriptionAccess>;
  listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]>;
}

// Interface for Stripe webhook idempotency + ordering checks — pure
// key-value with TTL.
export interface WebhookEventBackend {
  isProcessed(eventId: string): Promise<boolean>;
  isOutOfOrder(customerId: string, eventCreated: number): Promise<boolean>;
  markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): Promise<void>;
}

export class SubscriptionCustomerConflictError extends Error {
  constructor(
    customerId: string,
    existingGiteaOrgId: number,
    attemptedGiteaOrgId: number,
  ) {
    super(
      `Stripe customer ${customerId} is already bound to organization ${existingGiteaOrgId}; cannot rebind to ${attemptedGiteaOrgId}.`,
    );
    this.name = "SubscriptionCustomerConflictError";
  }
}

export class SubscriptionStore implements SubscriptionBackend {
  private db: SqliteDb;
  private organizations: OrganizationBackend;

  constructor(
    path: string = config.sessionsDbPath,
    organizations: OrganizationBackend = organizationStore,
  ) {
    this.db = openSqliteDb(path);
    this.organizations = organizations;
    this.enforceUniqueCustomerBindings();
  }

  async getByOrganization(
    giteaOrgId: number,
  ): Promise<SubscriptionRecord | null> {
    const row = this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.giteaOrgId, giteaOrgId))
      .get();
    return row ?? null;
  }

  async getByCustomerId(
    customerId: string,
  ): Promise<SubscriptionRecord | null> {
    const row = this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .get();
    return row ?? null;
  }

  async upsert(record: SubscriptionRecord): Promise<void> {
    const existingCustomerRecord = await this.getByCustomerId(
      record.stripeCustomerId,
    );
    if (
      existingCustomerRecord &&
      existingCustomerRecord.giteaOrgId !== record.giteaOrgId
    ) {
      logger.error("Rejected Stripe customer rebind attempt", {
        stripeCustomerId: record.stripeCustomerId,
        existingGiteaOrgId: existingCustomerRecord.giteaOrgId,
        attemptedGiteaOrgId: record.giteaOrgId,
        existingSubscriptionId: existingCustomerRecord.stripeSubscriptionId,
        attemptedSubscriptionId: record.stripeSubscriptionId,
      });
      throw new SubscriptionCustomerConflictError(
        record.stripeCustomerId,
        existingCustomerRecord.giteaOrgId,
        record.giteaOrgId,
      );
    }

    this.db
      .insert(subscriptions)
      .values(record)
      .onConflictDoUpdate({
        target: subscriptions.giteaOrgId,
        set: {
          stripeCustomerId: record.stripeCustomerId,
          stripeSubscriptionId: record.stripeSubscriptionId,
          status: record.status,
          currentPeriodEnd: record.currentPeriodEnd,
          cancelAtPeriodEnd: record.cancelAtPeriodEnd,
          cancelAt: record.cancelAt,
          updatedAt: record.updatedAt,
        },
      })
      .run();
  }

  async getAccessOverride(
    giteaOrgId: number,
  ): Promise<SubscriptionAccessOverrideRecord | null> {
    const row = this.db
      .select()
      .from(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.giteaOrgId, giteaOrgId))
      .get();
    return row ?? null;
  }

  async putAccessOverride(
    record: SubscriptionAccessOverrideRecord,
  ): Promise<void> {
    this.db
      .insert(subscriptionAccessOverrides)
      .values(record)
      .onConflictDoUpdate({
        target: subscriptionAccessOverrides.giteaOrgId,
        set: {
          access: record.access,
          reason: record.reason,
          updatedBy: record.updatedBy,
          updatedAt: record.updatedAt,
        },
      })
      .run();
  }

  async deleteAccessOverride(giteaOrgId: number): Promise<void> {
    this.db
      .delete(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.giteaOrgId, giteaOrgId))
      .run();
  }

  /**
   * Whether this organization may author right now, and on what authority.
   *
   * One precedence list, highest first, exactly as ADR 0004 states it. Keeping
   * it in one function is the whole reason two sources of access truth — a
   * Stripe subscription and a local trial column — are an acceptable cost.
   *
   *   1. `admin_revoke`  — no access, whatever else says.
   *   2. `admin_grant`   — access; the comp mechanism.
   *   3. Stripe `active` / `trialing`, with the 3-day grace on a stale period
   *      end that covers a missed webhook.
   *   4. The local trial: `organizations.trial_ends_at` still in the future.
   *      A column rather than a Stripe trialing subscription because #369
   *      wants no card at all, and representing that in Stripe would create a
   *      customer and a subscription for every tire-kicker.
   *   5. Otherwise, no access.
   */
  async resolveAccess(
    giteaOrgId: number,
  ): Promise<EffectiveSubscriptionAccess> {
    const subscription = await this.getByOrganization(giteaOrgId);
    const override = await this.getAccessOverride(giteaOrgId);
    const organization = await this.organizations.get(giteaOrgId);
    const trialEndsAt = organization?.trialEndsAt ?? null;

    const base = { giteaOrgId, subscription, override, trialEndsAt };

    if (override?.access === "revoke") {
      return { ...base, hasAccess: false, source: "admin_revoke" };
    }

    if (override?.access === "grant") {
      return { ...base, hasAccess: true, source: "admin_grant" };
    }

    if (hasStripeBackedAccess(subscription)) {
      return { ...base, hasAccess: true, source: "stripe" };
    }

    if (isInTrial(organization)) {
      return { ...base, hasAccess: true, source: "trial" };
    }

    return { ...base, hasAccess: false, source: "none" };
  }

  async listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]> {
    const orgIds = union(
      this.db
        .select({ giteaOrgId: subscriptions.giteaOrgId })
        .from(subscriptions),
      this.db
        .select({ giteaOrgId: subscriptionAccessOverrides.giteaOrgId })
        .from(subscriptionAccessOverrides),
    )
      .orderBy(sql`gitea_org_id ASC`)
      .all()
      .map((row) => row.giteaOrgId);

    // An organization on a trial has neither a subscription nor an override,
    // so it would be invisible here — and "who is in a trial right now" is the
    // question this list exists to answer for an admin.
    const trialOrgIds = (await this.organizations.list())
      .filter((organization) => isInTrial(organization))
      .map((organization) => organization.giteaOrgId);

    const allIds = [...new Set([...orgIds, ...trialOrgIds])].sort(
      (a, b) => a - b,
    );

    return Promise.all(allIds.map((orgId) => this.resolveAccess(orgId)));
  }

  // Legacy data hygiene: dedupe rows that predate the unique customer
  // binding, then (re)create the unique index. Must stay out of the drizzle
  // migrations — a unique index in the baseline would fail against a legacy
  // database that still holds duplicates.
  private enforceUniqueCustomerBindings(): void {
    this.db.transaction(
      (tx) => {
        const duplicates = tx
          .select({
            stripeCustomerId: subscriptions.stripeCustomerId,
            duplicateCount: count(),
          })
          .from(subscriptions)
          .groupBy(subscriptions.stripeCustomerId)
          .having(gt(count(), 1))
          .all();

        for (const duplicate of duplicates) {
          const rows = tx
            .select()
            .from(subscriptions)
            .where(
              eq(subscriptions.stripeCustomerId, duplicate.stripeCustomerId),
            )
            .orderBy(
              desc(subscriptions.updatedAt),
              asc(subscriptions.giteaOrgId),
            )
            .all();

          const [keptRow, ...removedRows] = rows;
          if (!keptRow || removedRows.length === 0) continue;

          logger.error(
            "Deduplicating legacy Stripe customer bindings during subscription migration",
            {
              stripeCustomerId: duplicate.stripeCustomerId,
              keptGiteaOrgId: keptRow.giteaOrgId,
              removedGiteaOrgIds: removedRows.map((row) => row.giteaOrgId),
              duplicateCount: duplicate.duplicateCount,
            },
          );

          for (const row of removedRows) {
            tx.delete(subscriptions)
              .where(eq(subscriptions.giteaOrgId, row.giteaOrgId))
              .run();
          }
        }

        tx.run(sql`DROP INDEX IF EXISTS idx_subscriptions_customer`);
        tx.run(
          sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id)`,
        );
      },
      { behavior: "immediate" },
    );
  }
}

export class WebhookEventStore implements WebhookEventBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const row = this.db
      .select({ eventId: processedWebhookEvents.eventId })
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.eventId, eventId))
      .get();
    return row !== undefined;
  }

  async isOutOfOrder(
    customerId: string,
    eventCreated: number,
  ): Promise<boolean> {
    const row = this.db
      .select({
        lastEventCreatedAt: webhookCustomerState.lastEventCreatedAt,
      })
      .from(webhookCustomerState)
      .where(eq(webhookCustomerState.customerId, customerId))
      .get();
    if (!row) return false;
    return eventCreated < row.lastEventCreatedAt;
  }

  async markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): Promise<void> {
    this.db
      .insert(processedWebhookEvents)
      .values({
        eventId,
        eventType,
        customerId,
        createdAt: eventCreated,
        processedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();

    if (customerId !== null) {
      this.db
        .insert(webhookCustomerState)
        .values({ customerId, lastEventCreatedAt: eventCreated })
        .onConflictDoUpdate({
          target: webhookCustomerState.customerId,
          set: {
            lastEventCreatedAt: sql`MAX(last_event_created_at, excluded.last_event_created_at)`,
          },
        })
        .run();
    }
  }
}

// Lazy wrapper so importing this module never opens the SQLite file; the DB
// is created on first use.
class LazyWebhookEventStore implements WebhookEventBackend {
  private _store: WebhookEventBackend | null = null;

  private get store(): WebhookEventBackend {
    if (!this._store) {
      this._store = new WebhookEventStore();
    }
    return this._store;
  }

  isProcessed(eventId: string): Promise<boolean> {
    return this.store.isProcessed(eventId);
  }

  isOutOfOrder(customerId: string, eventCreated: number): Promise<boolean> {
    return this.store.isOutOfOrder(customerId, eventCreated);
  }

  markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): Promise<void> {
    return this.store.markProcessed(
      eventId,
      eventType,
      customerId,
      eventCreated,
    );
  }
}

export const webhookEventStore = new LazyWebhookEventStore();

class LazySubscriptionStore implements SubscriptionBackend {
  private _store: SubscriptionBackend | null = null;

  private get store(): SubscriptionBackend {
    if (!this._store) {
      this._store = new SubscriptionStore();
    }
    return this._store;
  }

  getByOrganization(giteaOrgId: number): Promise<SubscriptionRecord | null> {
    return this.store.getByOrganization(giteaOrgId);
  }

  getByCustomerId(customerId: string): Promise<SubscriptionRecord | null> {
    return this.store.getByCustomerId(customerId);
  }

  upsert(record: SubscriptionRecord): Promise<void> {
    return this.store.upsert(record);
  }

  getAccessOverride(
    giteaOrgId: number,
  ): Promise<SubscriptionAccessOverrideRecord | null> {
    return this.store.getAccessOverride(giteaOrgId);
  }

  putAccessOverride(record: SubscriptionAccessOverrideRecord): Promise<void> {
    return this.store.putAccessOverride(record);
  }

  deleteAccessOverride(giteaOrgId: number): Promise<void> {
    return this.store.deleteAccessOverride(giteaOrgId);
  }

  resolveAccess(giteaOrgId: number): Promise<EffectiveSubscriptionAccess> {
    return this.store.resolveAccess(giteaOrgId);
  }

  listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]> {
    return this.store.listKnownAccessStates();
  }
}

export const subscriptionStore = new LazySubscriptionStore();

/** Whether this organization may author right now. */
export async function organizationHasAccess(
  giteaOrgId: number,
): Promise<boolean> {
  return (await subscriptionStore.resolveAccess(giteaOrgId)).hasAccess;
}
