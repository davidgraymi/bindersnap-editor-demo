import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { and, desc, eq, gt, lte, ne, notLike } from "drizzle-orm";
import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { sessions } from "./db/schema";
import { logger } from "./logger";

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
  /**
   * This person's unexpired sessions, newest first. For the one job that acts
   * as somebody who is not making the request: finishing an accepted
   * invitation with an owner's own token.
   */
  liveForUser?(username: string, now?: number): Promise<SessionRecord[]>;
  /**
   * A handle on a session that is not its cookie, for another table to keep
   * (`jobs.session_id`), and the session it names. Never fed from a request:
   * `get` takes only a cookie.
   */
  reference(id: string): string;
  getByReference(reference: string): Promise<SessionRecord | null>;
}

/**
 * **Nothing in the sessions database is enough to be anybody.**
 *
 * A row used to hold the cookie's value and the person's Gitea token as they
 * were, and Litestream copies the file off the host: a backup was a key to
 * every signed-in account. Now the row is keyed by an HMAC of the cookie under a
 * key outside the file, which cannot be turned back into one, and the token is sealed (AES-256-GCM) with a
 * key that lives in the environment, never in the file.
 *
 * A record read back from a list — `reap`, `deleteForUser`, `liveForUser` —
 * has no cookie to give, so its `id` is a reference (`ref:` and the row's
 * key), which only `getByReference` reads.
 *
 * **A cookie is always hashed.** `get` and `delete` never take a reference:
 * a cookie that looked like one would otherwise be the row's key, read
 * straight out of a leaked database.
 */
const REFERENCE = "ref:";
const SEALED = "enc:v1:";

function derivedKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", purpose, 32));
}

export function sealToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return (
    SEALED +
    Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url")
  );
}

/** The token, or null when this key did not seal it. */
export function openToken(stored: string, key: Buffer): string | null {
  if (!stored.startsWith(SEALED)) return null;
  try {
    const raw = Buffer.from(stored.slice(SEALED.length), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

type SessionRow = typeof sessions.$inferSelect;

export class SessionStore implements SessionBackend {
  private db: SqliteDb;
  private key: Buffer;
  private idKey: Buffer;

  constructor(
    path: string = config.sessionsDbPath,
    secret: string = config.sessionSecret,
  ) {
    this.db = openSqliteDb(path);
    this.key = derivedKey(secret, "bindersnap-session-token");
    this.idKey = derivedKey(secret, "bindersnap-session-id");
    this.sealLegacyRows();
  }

  /**
   * Rows written before sessions were sealed, sealed in place, so nobody
   * signed in at the time of the upgrade is signed out by it.
   */
  private sealLegacyRows(): void {
    const legacy = this.db
      .select()
      .from(sessions)
      .where(notLike(sessions.giteaToken, `${SEALED}%`))
      .all();
    if (legacy.length === 0) return;
    this.db.transaction((tx) => {
      for (const row of legacy) {
        tx.update(sessions)
          .set({
            id: this.rowKey(row.id),
            giteaToken: sealToken(row.giteaToken, this.key),
          })
          .where(eq(sessions.id, row.id))
          .run();
      }
    });
    logger.info("Sealed sessions written before tokens were sealed", {
      sessions: legacy.length,
    });
  }

  /** The row's key for a cookie: an HMAC, so the file alone cannot make one. */
  private rowKey(cookie: string): string {
    return createHmac("sha256", this.idKey).update(cookie).digest("hex");
  }

  reference(id: string): string {
    return `${REFERENCE}${this.rowKey(id)}`;
  }

  /**
   * A reference's row key. A value without the prefix is a cookie a jobs row
   * kept before references existed — read from our own database, not a
   * request — and is hashed like one.
   */
  private referencedKey(reference: string): string {
    return reference.startsWith(REFERENCE)
      ? reference.slice(REFERENCE.length)
      : this.rowKey(reference);
  }

  private readRow(key: string, id: string): SessionRecord | null {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, key))
      .get();
    if (!row) return null;
    const record = this.toRecord(row, id);
    // Sealed with another key — the secret was rotated. The session cannot
    // act as anybody, so it is not one.
    return record.giteaToken === "" ? null : record;
  }

  /** A row as a record; its token is "" when this key cannot open it. */
  private toRecord(row: SessionRow, id: string): SessionRecord {
    return {
      ...row,
      id,
      giteaToken: openToken(row.giteaToken, this.key) ?? "",
    };
  }

  private listed(rows: SessionRow[]): SessionRecord[] {
    return rows.map((row) => this.toRecord(row, `${REFERENCE}${row.id}`));
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.readRow(this.rowKey(id), id);
  }

  async getByReference(reference: string): Promise<SessionRecord | null> {
    return this.readRow(this.referencedKey(reference), reference);
  }

  async put(session: SessionRecord): Promise<void> {
    const row = {
      ...session,
      id: this.rowKey(session.id),
      giteaToken: sealToken(session.giteaToken, this.key),
    };
    this.db
      .insert(sessions)
      .values(row)
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          username: row.username,
          giteaToken: row.giteaToken,
          giteaTokenName: row.giteaTokenName,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        },
      })
      .run();
  }

  async delete(id: string): Promise<void> {
    this.db
      .delete(sessions)
      .where(eq(sessions.id, this.rowKey(id)))
      .run();
  }

  async reap(now: number): Promise<SessionRecord[]> {
    return this.listed(
      this.db
        .delete(sessions)
        .where(lte(sessions.expiresAt, now))
        .returning()
        .all(),
    );
  }

  async deleteForUser(
    username: string,
    except?: string,
  ): Promise<SessionRecord[]> {
    return this.listed(
      this.db
        .delete(sessions)
        .where(
          except === undefined
            ? eq(sessions.username, username)
            : and(
                eq(sessions.username, username),
                ne(sessions.id, this.rowKey(except)),
              ),
        )
        .returning()
        .all(),
    );
  }

  async liveForUser(
    username: string,
    now = Date.now(),
  ): Promise<SessionRecord[]> {
    return this.listed(
      this.db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.username, username), gt(sessions.expiresAt, now)),
        )
        .orderBy(desc(sessions.createdAt))
        .all(),
    ).filter((session) => session.giteaToken !== "");
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

  liveForUser(username: string, now?: number): Promise<SessionRecord[]> {
    return this.store.liveForUser?.(username, now) ?? Promise.resolve([]);
  }

  reference(id: string): string {
    return this.store.reference(id);
  }

  getByReference(reference: string): Promise<SessionRecord | null> {
    return this.store.getByReference(reference);
  }
}

export const sessionStore = new LazySessionStore();
