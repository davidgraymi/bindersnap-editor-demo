import { eq, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type SessionBackend, type SessionRecord } from "../sessions";
import { getPostgresDb } from "./client";
import { sessions } from "./schema";

// Postgres-backed SessionBackend. Uses the shared lazy client unless an
// explicit drizzle instance is passed in (tests). Schema is owned by the
// migration runner — this file only reads/writes rows.
export class PostgresSessionBackend implements SessionBackend {
  private readonly db: PostgresJsDatabase;

  constructor(db?: PostgresJsDatabase) {
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
    return {
      id: row.id,
      username: row.username,
      giteaToken: row.giteaToken,
      giteaTokenName: row.giteaTokenName,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async put(session: SessionRecord): Promise<void> {
    await this.db
      .insert(sessions)
      .values({
        id: session.id,
        username: session.username,
        giteaToken: session.giteaToken,
        giteaTokenName: session.giteaTokenName,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          username: session.username,
          giteaToken: session.giteaToken,
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
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      giteaToken: row.giteaToken,
      giteaTokenName: row.giteaTokenName,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }));
  }
}
