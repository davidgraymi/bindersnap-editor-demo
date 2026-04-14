import { Database } from "bun:sqlite";

const DB_PATH =
  process.env.BINDERSNAP_SESSIONS_DB_PATH ?? "/var/lib/bindersnap/sessions.db";

export interface SessionRecord {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
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

export class SessionStore {
  private db: Database;

  constructor(path: string = DB_PATH) {
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

  get(id: string): SessionRecord | null {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? rowToRecord(row) : null;
  }

  put(session: SessionRecord): void {
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

  delete(id: string): void {
    this.db
      .query<void, [string]>("DELETE FROM sessions WHERE id = ?")
      .run(id);
  }

  reap(now: number): SessionRecord[] {
    const rows = this.db
      .query<SessionRow, [number]>(
        "SELECT * FROM sessions WHERE expires_at <= ?",
      )
      .all(now);

    if (rows.length > 0) {
      this.db
        .query<void, [number]>("DELETE FROM sessions WHERE expires_at <= ?")
        .run(now);
    }

    return rows.map(rowToRecord);
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
