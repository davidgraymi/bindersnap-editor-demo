import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schemaVersions } from "./schema";

// Bumped by hand whenever a migration lands. The migration runner writes this
// value into schema_versions after applying; the API verifies the value
// matches at startup and exits otherwise.
//
// Format: ISO-like string keyed to the migration journal entry that introduced
// the change. Keep in sync with the latest entry in db/migrations/meta/_journal.json.
export const EXPECTED_SCHEMA_VERSION = "0000_initial";

export class SchemaVersionMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string | null,
  ) {
    super(
      actual === null
        ? `Database has no schema_versions row. Run the migration runner before starting the API. Expected ${expected}.`
        : `Database schema version ${actual} does not match code-expected ${expected}. Run the migration runner before starting the API.`,
    );
    this.name = "SchemaVersionMismatchError";
  }
}

// Reads the singleton row in schema_versions. Returns null if the table is
// empty, which means the migration runner has never been run successfully.
export async function readSchemaVersion(
  db: PostgresJsDatabase,
): Promise<string | null> {
  const rows = await db
    .select({ version: schemaVersions.version })
    .from(schemaVersions)
    .where(sql`${schemaVersions.id} = 1`)
    .limit(1);
  return rows[0]?.version ?? null;
}

export async function assertSchemaVersionMatches(
  db: PostgresJsDatabase,
): Promise<void> {
  const actual = await readSchemaVersion(db);
  if (actual !== EXPECTED_SCHEMA_VERSION) {
    throw new SchemaVersionMismatchError(EXPECTED_SCHEMA_VERSION, actual);
  }
}
