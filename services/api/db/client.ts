import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";

// Lazy Postgres connection used by the runtime backends in this directory.
// One connection pool per process; created on first call.
//
// The connection string is read from BINDERSNAP_DATABASE_URL (via config),
// which is only consulted when BINDERSNAP_DB_BACKEND=postgres.

let client: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase | null = null;

export interface PostgresClientOptions {
  url?: string;
  max?: number;
}

export function getPostgresDb(
  options: PostgresClientOptions = {},
): PostgresJsDatabase {
  if (db) return db;
  const url = options.url ?? config.databaseUrl;
  if (!url) {
    throw new Error(
      "BINDERSNAP_DATABASE_URL is required when BINDERSNAP_DB_BACKEND=postgres.",
    );
  }
  client = postgres(url, { max: options.max ?? 10, prepare: false });
  db = drizzle(client);
  return db;
}

// Test-only: install a pre-built drizzle DB and underlying client so tests can
// share one connection across backends without paying connection cost per test.
export function __setPostgresDbForTests(
  newDb: PostgresJsDatabase,
  newClient: ReturnType<typeof postgres>,
): void {
  client = newClient;
  db = newDb;
}

export async function closePostgresDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    db = null;
  }
}

// Test-only: reset the module-level singletons so tests can supply their own
// connection. Not exported through the API surface.
export function __resetPostgresDbForTests(): void {
  client = null;
  db = null;
}
