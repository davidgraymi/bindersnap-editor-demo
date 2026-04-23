import { Database } from "bun:sqlite";

const DB_PATH =
  process.env.BINDERSNAP_SESSIONS_DB_PATH ?? "/var/lib/bindersnap/sessions.db";

export interface SubscriptionRecord {
  username: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string; // 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodEnd: number | null; // Unix seconds
  updatedAt: number;
}

interface SubscriptionRow {
  username: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_end: number | null;
  updated_at: number;
}

function rowToRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    username: row.username,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    updatedAt: row.updated_at,
  };
}

export class SubscriptionStore {
  private db: Database;

  constructor(path: string = DB_PATH) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        username TEXT PRIMARY KEY,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_end INTEGER,
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
      .query<void, [string, string, string, string, number | null, number]>(
        `INSERT INTO subscriptions (username, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           stripe_customer_id = excluded.stripe_customer_id,
           stripe_subscription_id = excluded.stripe_subscription_id,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.username,
        record.stripeCustomerId,
        record.stripeSubscriptionId,
        record.status,
        record.currentPeriodEnd,
        record.updatedAt,
      );
  }
}

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
  return record?.status === "active" || record?.status === "trialing";
}
