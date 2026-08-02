import { eq, lte } from "drizzle-orm";
import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { sessions } from "./db/schema";

export interface SessionRecord {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
}

// Interface for the session store: SQLite in production (on the EBS data
// volume), in-memory for tests. Async so callers never assume a sync backend.
export interface SessionBackend {
  get(id: string): Promise<SessionRecord | null>;
  put(session: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  reap(now: number): Promise<SessionRecord[]>;
}

export class SessionStore implements SessionBackend {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    return row ?? null;
  }

  async put(session: SessionRecord): Promise<void> {
    this.db
      .insert(sessions)
      .values(session)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          username: session.username,
          giteaToken: session.giteaToken,
          giteaTokenName: session.giteaTokenName,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      })
      .run();
  }

  async delete(id: string): Promise<void> {
    this.db.delete(sessions).where(eq(sessions.id, id)).run();
  }

  async reap(now: number): Promise<SessionRecord[]> {
    return this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning()
      .all();
  }
}

// Lazy wrapper so importing this module never opens the SQLite file; the DB
// is created on first use.
class LazySessionStore implements SessionBackend {
  private _store: SessionBackend | null = null;

  private get store(): SessionBackend {
    if (!this._store) {
      this._store = new SessionStore();
    }
    return this._store;
  }

  get(id: string): Promise<SessionRecord | null> {
    return this.store.get(id);
  }

  put(session: SessionRecord): Promise<void> {
    return this.store.put(session);
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }

  reap(now: number): Promise<SessionRecord[]> {
    return this.store.reap(now);
  }
}

export const sessionStore = new LazySessionStore();
