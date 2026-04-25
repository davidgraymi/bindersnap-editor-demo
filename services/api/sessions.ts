import { eq, lte } from "drizzle-orm";
import { config } from "./config";
import { createDb } from "./db/client";
import { sessions } from "./db/schema";

export interface SessionRecord {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
}

export class SessionStore {
  private db: ReturnType<typeof createDb>;

  constructor(path: string = config.sessionsDbPath) {
    this.db = createDb(path);
  }

  get(id: string): SessionRecord | null {
    return (
      this.db.select().from(sessions).where(eq(sessions.id, id)).get() ?? null
    );
  }

  put(session: SessionRecord): void {
    this.db
      .insert(sessions)
      .values(session)
      .onConflictDoUpdate({
        target: sessions.id,
        set: session,
      })
      .run();
  }

  delete(id: string): void {
    this.db.delete(sessions).where(eq(sessions.id, id)).run();
  }

  reap(now: number): SessionRecord[] {
    const expiredSessions = this.db
      .select()
      .from(sessions)
      .where(lte(sessions.expiresAt, now))
      .all();

    if (expiredSessions.length > 0) {
      this.db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
    }

    return expiredSessions;
  }
}

class LazySessionStore {
  private _store: SessionStore | null = null;

  private get store(): SessionStore {
    if (!this._store) {
      this._store = new SessionStore();
    }
    return this._store;
  }

  get(id: string): SessionRecord | null {
    return this.store.get(id);
  }

  put(session: SessionRecord): void {
    this.store.put(session);
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  reap(now: number): SessionRecord[] {
    return this.store.reap(now);
  }
}

export const sessionStore = new LazySessionStore();
