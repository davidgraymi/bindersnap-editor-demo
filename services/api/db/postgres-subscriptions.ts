import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logger } from "../logger";
import {
  SubscriptionCustomerConflictError,
  type EffectiveSubscriptionAccess,
  type SubscriptionAccessOverrideRecord,
  type SubscriptionBackend,
  type SubscriptionRecord,
  type WebhookEventBackend,
} from "../subscriptions";
import { getPostgresDb } from "./client";
import {
  processedWebhookEvents,
  subscriptionAccessOverrides,
  subscriptions,
  webhookCustomerState,
} from "./schema";

// 3-day grace window for currentPeriodEnd: defense-in-depth against missed
// webhook delivery, mirroring the SQLite backend exactly.
const CURRENT_PERIOD_END_GRACE_SECONDS = 3 * 24 * 60 * 60;

function rowToSubscription(
  row: typeof subscriptions.$inferSelect,
): SubscriptionRecord {
  return {
    username: row.username,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: row.cancelAt,
    updatedAt: row.updatedAt,
  };
}

function rowToOverride(
  row: typeof subscriptionAccessOverrides.$inferSelect,
): SubscriptionAccessOverrideRecord {
  return {
    username: row.username,
    access: row.access,
    reason: row.reason,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

function hasStripeBackedAccess(record: SubscriptionRecord | null): boolean {
  if (!record) return false;
  if (record.status !== "active" && record.status !== "trialing") return false;
  if (record.currentPeriodEnd !== null) {
    if (
      record.currentPeriodEnd + CURRENT_PERIOD_END_GRACE_SECONDS <
      Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
  }
  return true;
}

export class PostgresSubscriptionBackend implements SubscriptionBackend {
  private readonly db: PostgresJsDatabase;

  constructor(db?: PostgresJsDatabase) {
    this.db = db ?? getPostgresDb();
  }

  async getByUsername(username: string): Promise<SubscriptionRecord | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.username, username))
      .limit(1);
    return rows[0] ? rowToSubscription(rows[0]) : null;
  }

  async getByCustomerId(
    customerId: string,
  ): Promise<SubscriptionRecord | null> {
    const rows = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1);
    return rows[0] ? rowToSubscription(rows[0]) : null;
  }

  // Customer-uniqueness invariant: in Postgres this is enforced both by the
  // UNIQUE INDEX on stripe_customer_id (created in the initial migration) and
  // by an explicit pre-check inside a transaction so we can return a typed
  // SubscriptionCustomerConflictError instead of a raw 23505 from the driver.
  async upsert(record: SubscriptionRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, record.stripeCustomerId))
        .limit(1);
      const conflict = existing[0];
      if (conflict && conflict.username !== record.username) {
        logger.error("Rejected Stripe customer rebind attempt", {
          stripeCustomerId: record.stripeCustomerId,
          existingUsername: conflict.username,
          attemptedUsername: record.username,
          existingSubscriptionId: conflict.stripeSubscriptionId,
          attemptedSubscriptionId: record.stripeSubscriptionId,
        });
        throw new SubscriptionCustomerConflictError(
          record.stripeCustomerId,
          conflict.username,
          record.username,
        );
      }

      await tx
        .insert(subscriptions)
        .values({
          username: record.username,
          stripeCustomerId: record.stripeCustomerId,
          stripeSubscriptionId: record.stripeSubscriptionId,
          status: record.status,
          currentPeriodEnd: record.currentPeriodEnd,
          cancelAtPeriodEnd: record.cancelAtPeriodEnd,
          cancelAt: record.cancelAt,
          updatedAt: record.updatedAt,
        })
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
        });
    });
  }

  async getAccessOverride(
    username: string,
  ): Promise<SubscriptionAccessOverrideRecord | null> {
    const rows = await this.db
      .select()
      .from(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.username, username))
      .limit(1);
    return rows[0] ? rowToOverride(rows[0]) : null;
  }

  async putAccessOverride(
    record: SubscriptionAccessOverrideRecord,
  ): Promise<void> {
    await this.db
      .insert(subscriptionAccessOverrides)
      .values({
        username: record.username,
        access: record.access,
        reason: record.reason,
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: subscriptionAccessOverrides.username,
        set: {
          access: record.access,
          reason: record.reason,
          updatedBy: record.updatedBy,
          updatedAt: record.updatedAt,
        },
      });
  }

  async deleteAccessOverride(username: string): Promise<void> {
    await this.db
      .delete(subscriptionAccessOverrides)
      .where(eq(subscriptionAccessOverrides.username, username));
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

  // SQLite uses `ORDER BY username COLLATE NOCASE`; Postgres has no NOCASE
  // collation by default so sort case-insensitively via LOWER() to keep
  // listings stable across backends.
  async listKnownAccessStates(): Promise<EffectiveSubscriptionAccess[]> {
    const result = await this.db.execute<{ username: string }>(sql`
      SELECT username FROM ${subscriptions}
      UNION
      SELECT username FROM ${subscriptionAccessOverrides}
      ORDER BY LOWER(username) ASC
    `);
    const usernames = (result as unknown as { username: string }[]).map(
      (row) => row.username,
    );
    return Promise.all(
      usernames.map((username) => this.resolveAccess(username)),
    );
  }
}

export class PostgresWebhookEventBackend implements WebhookEventBackend {
  private readonly db: PostgresJsDatabase;

  constructor(db?: PostgresJsDatabase) {
    this.db = db ?? getPostgresDb();
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: processedWebhookEvents.eventId })
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  async isOutOfOrder(
    customerId: string,
    eventCreated: number,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ last: webhookCustomerState.lastEventCreatedAt })
      .from(webhookCustomerState)
      .where(eq(webhookCustomerState.customerId, customerId))
      .limit(1);
    const last = rows[0]?.last;
    if (last === undefined) return false;
    return eventCreated < last;
  }

  async markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): Promise<void> {
    await this.db
      .insert(processedWebhookEvents)
      .values({
        eventId,
        eventType,
        customerId,
        createdAt: eventCreated,
        processedAt: Date.now(),
      })
      .onConflictDoNothing({ target: processedWebhookEvents.eventId });

    if (customerId !== null) {
      await this.db
        .insert(webhookCustomerState)
        .values({
          customerId,
          lastEventCreatedAt: eventCreated,
        })
        .onConflictDoUpdate({
          target: webhookCustomerState.customerId,
          set: {
            lastEventCreatedAt: sql`GREATEST(${webhookCustomerState.lastEventCreatedAt}, EXCLUDED.last_event_created_at)`,
          },
        });
    }
  }
}
