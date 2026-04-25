import { eq } from "drizzle-orm";
import { config } from "./config";
import { createDb } from "./db/client";
import { subscriptions } from "./db/schema";

export interface SubscriptionRecord {
  username: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string; // 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodEnd: number | null; // Unix seconds
  updatedAt: number;
}

export class SubscriptionStore {
  private db: ReturnType<typeof createDb>;

  constructor(path: string = config.sessionsDbPath) {
    this.db = createDb(path);
  }

  getByUsername(username: string): SubscriptionRecord | null {
    return (
      this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.username, username))
        .get() ?? null
    );
  }

  getByCustomerId(customerId: string): SubscriptionRecord | null {
    return (
      this.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, customerId))
        .get() ?? null
    );
  }

  upsert(record: SubscriptionRecord): void {
    this.db
      .insert(subscriptions)
      .values(record)
      .onConflictDoUpdate({
        target: subscriptions.username,
        set: record,
      })
      .run();
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
