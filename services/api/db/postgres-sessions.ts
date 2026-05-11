import { eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type SessionBackend, type SessionRecord } from "../sessions";
import type { TokenCrypto } from "../token-crypto";
import { getPostgresDb } from "./client";
import { sessions } from "./schema";

// Postgres-backed SessionBackend. Stores `gitea_token` envelope-encrypted at
// rest (see token-crypto.ts): each row carries a per-session DEK (wrapped by
// the master key) plus a GCM-sealed token ciphertext. A pg_dump of `sessions`
// therefore contains neither plaintext tokens nor unwrapped DEKs.
//
// Schema ownership stays with the migration runner — this file only
// reads/writes rows. The shared lazy client is used unless an explicit drizzle
// instance is passed (tests).
export class PostgresSessionBackend implements SessionBackend {
  private readonly db: PostgresJsDatabase;
  private readonly crypto: TokenCrypto;

  constructor(crypto: TokenCrypto, db?: PostgresJsDatabase) {
    this.crypto = crypto;
    this.db = db ?? getPostgresDb();
  }

  async get(id: string): Promise<SessionRecord | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.rowToRecord(row);
  }

  async put(session: SessionRecord): Promise<void> {
    const { ciphertext, wrappedDek } = await this.crypto.encrypt(
      session.giteaToken,
    );
    await this.db
      .insert(sessions)
      .values({
        id: session.id,
        username: session.username,
        giteaTokenCiphertext: ciphertext,
        giteaTokenDek: wrappedDek,
        giteaTokenName: session.giteaTokenName,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          username: session.username,
          giteaTokenCiphertext: ciphertext,
          giteaTokenDek: wrappedDek,
          giteaTokenName: session.giteaTokenName,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  // DELETE ... RETURNING * collapses the legacy two-statement (SELECT then
  // DELETE) reap to a single round trip and removes the race where a session
  // could be returned by SELECT but deleted concurrently before the DELETE.
  async reap(now: number): Promise<SessionRecord[]> {
    const rows = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning();
    const records: SessionRecord[] = [];
    for (const row of rows) {
      records.push(await this.rowToRecord(row));
    }
    return records;
  }

  private async rowToRecord(row: {
    id: string;
    username: string;
    giteaTokenCiphertext: Buffer;
    giteaTokenDek: Buffer;
    giteaTokenName: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<SessionRecord> {
    const giteaToken = await this.crypto.decrypt(
      row.giteaTokenCiphertext,
      row.giteaTokenDek,
    );
    return {
      id: row.id,
      username: row.username,
      giteaToken,
      giteaTokenName: row.giteaTokenName,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
}
