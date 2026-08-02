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

export interface SubscriptionRecord {
  username: string;
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
  username: string;
  access: SubscriptionAccessOverrideValue;
  reason: string | null;
  updatedBy: string;
  updatedAt: number;
}

export interface EffectiveSubscriptionAccess {
  username: string;
  hasAccess: boolean;
  source: "stripe" | "admin_grant" | "admin_revoke" | "none";
  subscription: SubscriptionRecord | null;
  override: SubscriptionAccessOverrideRecord | null;
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
  getByUsername(username: string): Promise<SubscriptionRecord | null>;
  getByCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
  upsert(record: SubscriptionRecord): Promise<void>;
  getAccessOverride(
    username: string,
  ): Promise<SubscriptionAccessOverrideRecord | null>;
  putAccessOverride(record: SubscriptionAccessOverrideRecord): Promise<void>;
  deleteAccessOverride(username: string): Promise<void>;
  resolveAccess(username: string): Promise<EffectiveSubscriptionAccess>;
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
    existingUsername: string,
    attemptedUsername: string,
  ) {
    super(
      `Stripe customer ${customerId} is already bound to ${existingUsername}; cannot rebind to ${attemptedUsername}.`,
    );
    this.name = "SubscriptionCustomerConflictError";
  }
}

export class SubscriptionStore implements SubscriptionBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
    this.enforceUniqueCustomerBindings();
  }

  async getByUsername(username: string): Promise<SubscriptionRecord | null> {
    const row = this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.username, username))
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
      existingCustomerRecord.username !== record.username
    ) {
      logger.error("Rejected Stripe customer rebind attempt", {
        stripeCustomerId: record.stripeCustomerId,
        existingUsername: existingCustomerRecord.username,
        attemptedUsername: record.username,
        existingSubscriptionId: existingCustomerRecord.stripeSubscriptionId,
        attemptedSubscriptionId: record.stripeSubscriptionId,
      });
      throw new SubscriptionCustomerConflictError(
        record.stripeCustomerId,
        existingCustomerRecord.username,
        record.username,
      );
    }

    this.db
      .insert(subscriptions)
      .values(record)
      .onConflictDoUpdate({
        target: subscriptions.username,
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
    username: string,
  ): Promise<SubscriptionAccessOverrideRecord | null> {
    const row = this.db
      .select()
      .from(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.username, username))
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
        target: subscriptionAccessOverrides.username,
        set: {
          access: record.access,
          reason: record.reason,
          updatedBy: record.updatedBy,
          updatedAt: record.updatedAt,
        },
      })
      .run();
  }

  async deleteAccessOverride(username: string): Promise<void> {
    this.db
      .delete(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.username, username))
      .run();
  }

  async resolveAccess(username: string): Promise<EffectiveSubscriptionAccess> {
    const subscription = await this.getByUsername(username);
    const override = await this.getAccessOverride(username);

    if (override?.access === "grant") {
      return {
        username,
        hasAccess: true,
        source: "admin_grant",
        subscription,
        override,
      };
    }

    if (override?.access === "revoke") {
      return {
        username,
        hasAccess: false,
        source: "admin_revoke",
        subscription,
        override,
      };
    }

    if (hasStripeBackedAccess(subscription)) {
      return {
        username,
        hasAccess: true,
        source: "stripe",
        subscription,
        override,
      };
    }

    return {
      username,
      hasAccess: false,
      source: "none",
      subscription,
      override,
    };
  }

  async listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]> {
    const usernames = union(
      this.db.select({ username: subscriptions.username }).from(subscriptions),
      this.db
        .select({ username: subscriptionAccessOverrides.username })
        .from(subscriptionAccessOverrides),
    )
      .orderBy(sql`username COLLATE NOCASE ASC`)
      .all()
      .map((row) => row.username);

    return Promise.all(
      usernames.map((username) => this.resolveAccess(username)),
    );
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
            .orderBy(desc(subscriptions.updatedAt), asc(subscriptions.username))
            .all();

          const [keptRow, ...removedRows] = rows;
          if (!keptRow || removedRows.length === 0) continue;

          logger.error(
            "Deduplicating legacy Stripe customer bindings during subscription migration",
            {
              stripeCustomerId: duplicate.stripeCustomerId,
              keptUsername: keptRow.username,
              removedUsernames: removedRows.map((row) => row.username),
              duplicateCount: duplicate.duplicateCount,
            },
          );

          for (const row of removedRows) {
            tx.delete(subscriptions)
              .where(eq(subscriptions.username, row.username))
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

  getByUsername(username: string): Promise<SubscriptionRecord | null> {
    return this.store.getByUsername(username);
  }

  getByCustomerId(customerId: string): Promise<SubscriptionRecord | null> {
    return this.store.getByCustomerId(customerId);
  }

  upsert(record: SubscriptionRecord): Promise<void> {
    return this.store.upsert(record);
  }

  getAccessOverride(
    username: string,
  ): Promise<SubscriptionAccessOverrideRecord | null> {
    return this.store.getAccessOverride(username);
  }

  putAccessOverride(record: SubscriptionAccessOverrideRecord): Promise<void> {
    return this.store.putAccessOverride(record);
  }

  deleteAccessOverride(username: string): Promise<void> {
    return this.store.deleteAccessOverride(username);
  }

  resolveAccess(username: string): Promise<EffectiveSubscriptionAccess> {
    return this.store.resolveAccess(username);
  }

  listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]> {
    return this.store.listKnownAccessStates();
  }
}

export const subscriptionStore = new LazySubscriptionStore();

export async function hasActiveSubscription(
  username: string,
): Promise<boolean> {
  return (await subscriptionStore.resolveAccess(username)).hasAccess;
}
