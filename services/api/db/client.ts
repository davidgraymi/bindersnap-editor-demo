import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";

const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

export type SqliteDb = BunSQLiteDatabase;

// Opens the SQLite file behind bun:sqlite, wraps it in drizzle, and brings the
// schema up to date. Each store opens its own connection (WAL makes that safe
// within one process) and migrate() is idempotent — it consults the
// __drizzle_migrations journal and applies only what's missing, so calling
// this from every store constructor is cheap.
export function openSqliteDb(path: string): SqliteDb {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode=WAL");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
