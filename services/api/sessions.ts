import { and, eq, lte, ne } from "drizzle-orm";
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
  /**
   * Remove every session of this person's except one, and answer with them.
   *
   * For the moments a person's other devices must stop being them: a new
   * password, and an account being deleted. The caller revokes each one's
   * Gitea token — a deleted row alone would leave the token working.
   */
  deleteForUser(username: string, except?: string): Promise<SessionRecord[]>;
  /** A renamed account's sessions follow it, so nobody is signed out. */
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

  async deleteForUser(
    username: string,
    except?: string,
  ): Promise<SessionRecord[]> {
    return this.db
      .delete(sessions)
      .where(
        except === undefined
          ? eq(sessions.username, username)
          : and(eq(sessions.username, username), ne(sessions.id, except)),
      )
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

  deleteForUser(username: string, except?: string): Promise<SessionRecord[]> {
    return this.store.deleteForUser(username, except);
  }
}

export const sessionStore = new LazySessionStore();
