import { Database } from "bun:sqlite";
import { config } from "./config";

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

interface SubscriptionRow {
  username: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  cancel_at: number | null;
  updated_at: number;
}

function rowToRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    username: row.username,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    cancelAt: row.cancel_at,
    updatedAt: row.updated_at,
  };
}

export class SubscriptionStore {
  private db: Database;

  constructor(path: string = config.sessionsDbPath) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        username TEXT PRIMARY KEY,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end INTEGER,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        cancel_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
    `);
  }

  getByUsername(username: string): SubscriptionRecord | null {
    const row = this.db
      .query<
        SubscriptionRow,
        [string]
      >("SELECT * FROM subscriptions WHERE username = ?")
      .get(username);
    return row ? rowToRecord(row) : null;
  }

  getByCustomerId(customerId: string): SubscriptionRecord | null {
    const row = this.db
      .query<
        SubscriptionRow,
        [string]
      >("SELECT * FROM subscriptions WHERE stripe_customer_id = ?")
      .get(customerId);
    return row ? rowToRecord(row) : null;
  }

  upsert(record: SubscriptionRecord): void {
    this.db
      .query<void, [string, string, string, string, number | null, number, number | null, number]>(
        `INSERT INTO subscriptions (username, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, cancel_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           stripe_customer_id = excluded.stripe_customer_id,
           stripe_subscription_id = excluded.stripe_subscription_id,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           cancel_at = excluded.cancel_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.username,
        record.stripeCustomerId,
        record.stripeSubscriptionId,
        record.status,
        record.currentPeriodEnd,
        record.cancelAtPeriodEnd ? 1 : 0,
        record.cancelAt,
        record.updatedAt,
      );
  }
}

export class WebhookEventStore {
  private db: Database;

  constructor(path: string = config.sessionsDbPath) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        customer_id TEXT,
        created_at INTEGER NOT NULL,
        processed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhook_customer_state (
        customer_id TEXT PRIMARY KEY,
        last_event_created_at INTEGER NOT NULL
      );
    `);
  }

  isProcessed(eventId: string): boolean {
    const row = this.db
      .query<
        { event_id: string },
        [string]
      >("SELECT event_id FROM processed_webhook_events WHERE event_id = ?")
      .get(eventId);
    return row !== null;
  }

  isOutOfOrder(customerId: string, eventCreated: number): boolean {
    const row = this.db
      .query<
        { last_event_created_at: number },
        [string]
      >("SELECT last_event_created_at FROM webhook_customer_state WHERE customer_id = ?")
      .get(customerId);
    if (!row) return false;
    return eventCreated < row.last_event_created_at;
  }

  markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): void {
    this.db
      .query<void, [string, string, string | null, number, number]>(
        `INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type, customer_id, created_at, processed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(eventId, eventType, customerId, eventCreated, Date.now());

    if (customerId !== null) {
      this.db
        .query<void, [string, number]>(
          `INSERT INTO webhook_customer_state (customer_id, last_event_created_at)
           VALUES (?, ?)
           ON CONFLICT(customer_id) DO UPDATE SET
             last_event_created_at = MAX(last_event_created_at, excluded.last_event_created_at)`,
        )
        .run(customerId, eventCreated);
    }
  }
}

class LazyWebhookEventStore {
  private _store: WebhookEventStore | null = null;

  private get store(): WebhookEventStore {
    if (!this._store) {
      this._store = new WebhookEventStore();
    }
    return this._store;
  }

  isProcessed(eventId: string): boolean {
    return this.store.isProcessed(eventId);
  }

  isOutOfOrder(customerId: string, eventCreated: number): boolean {
    return this.store.isOutOfOrder(customerId, eventCreated);
  }

  markProcessed(
    eventId: string,
    eventType: string,
    customerId: string | null,
    eventCreated: number,
  ): void {
    this.store.markProcessed(eventId, eventType, customerId, eventCreated);
  }
}

export const webhookEventStore = new LazyWebhookEventStore();

class LazySubscriptionStore {
  private _store: SubscriptionStore | null = null;

  private get store(): SubscriptionStore {
    if (!this._store) {
      this._store = new SubscriptionStore();
    }
    return this._store;
  }

  getByUsername(username: string): SubscriptionRecord | null {
    return this.store.getByUsername(username);
  }

  getByCustomerId(customerId: string): SubscriptionRecord | null {
    return this.store.getByCustomerId(customerId);
  }

  upsert(record: SubscriptionRecord): void {
    this.store.upsert(record);
  }
}

export const subscriptionStore = new LazySubscriptionStore();

export function hasActiveSubscription(username: string): boolean {
  const record = subscriptionStore.getByUsername(username);
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
