import { Database } from "bun:sqlite";
import { config } from "./config";

export interface SessionRecord {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
}

// Backend-agnostic interface for the session store. Implementations may be
// SQLite (current), Postgres (planned, see #224), or in-memory (tests).
// Async because the Postgres backend is async; SQLite wraps sync calls in
// Promise.resolve to satisfy the interface.
export interface SessionBackend {
  get(id: string): Promise<SessionRecord | null>;
  put(session: SessionRecord): Promise<void>;
  delete(id: string): Promise<void>;
  reap(now: number): Promise<SessionRecord[]>;
}

interface SessionRow {
  id: string;
  username: string;
  gitea_token: string;
  gitea_token_name: string;
  created_at: number;
  expires_at: number;
}

function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    username: row.username,
    giteaToken: row.gitea_token,
    giteaTokenName: row.gitea_token_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class SessionStore implements SessionBackend {
  private db: Database;

  constructor(path: string = config.sessionsDbPath) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        gitea_token TEXT NOT NULL,
        gitea_token_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? rowToRecord(row) : null;
  }

  async put(session: SessionRecord): Promise<void> {
    this.db
      .query<void, [string, string, string, string, number, number]>(
        `INSERT INTO sessions (id, username, gitea_token, gitea_token_name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           username = excluded.username,
           gitea_token = excluded.gitea_token,
           gitea_token_name = excluded.gitea_token_name,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        session.id,
        session.username,
        session.giteaToken,
        session.giteaTokenName,
        session.createdAt,
        session.expiresAt,
      );
  }

  async delete(id: string): Promise<void> {
    this.db.query<void, [string]>("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async reap(now: number): Promise<SessionRecord[]> {
    const rows = this.db
      .query<
        SessionRow,
        [number]
      >("SELECT * FROM sessions WHERE expires_at <= ?")
      .all(now);

    if (rows.length > 0) {
      this.db
        .query<void, [number]>("DELETE FROM sessions WHERE expires_at <= ?")
        .run(now);
    }

    return rows.map(rowToRecord);
  }
}

// Factory used by the lazy singleton. Override (e.g., from a future
// dynamodb-backed module) to swap the production backend at startup.
export type SessionBackendFactory = () => SessionBackend;

let sessionBackendFactory: SessionBackendFactory = () => new SessionStore();

export function setSessionBackendFactory(factory: SessionBackendFactory): void {
  sessionBackendFactory = factory;
}

class LazySessionStore implements SessionBackend {
  private _store: SessionBackend | null = null;

  private get store(): SessionBackend {
    if (!this._store) {
      this._store = sessionBackendFactory();
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
