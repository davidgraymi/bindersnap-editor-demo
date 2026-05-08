import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Lazy Postgres connection used by the runtime backends in this directory.
// One connection pool per process; created on first call.
//
// The connection string is read from BINDERSNAP_DATABASE_URL, which is only
// consulted when the API is configured with BINDERSNAP_DB_BACKEND=postgres.

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
  const url = options.url ?? process.env.BINDERSNAP_DATABASE_URL;
  if (!url) {
    throw new Error(
      "BINDERSNAP_DATABASE_URL is required when BINDERSNAP_DB_BACKEND=postgres.",
    );
  }
  client = postgres(url, { max: options.max ?? 10, prepare: false });
  db = drizzle(client);
  return db;
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
