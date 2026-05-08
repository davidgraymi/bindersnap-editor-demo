// Standalone migration runner. NOT used by the API service at runtime.
// Invoked by `bun run db:migrate` (CI deploy, local dev, integration tests).
//
// Reads BINDERSNAP_DATABASE_URL, applies the SQL files in
// services/api/db/migrations/, and writes the latest journal version into
// the schema_versions table.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readLatestJournalTag(): string {
  const journalPath = join(MIGRATIONS_DIR, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as Journal;
  if (journal.entries.length === 0) {
    throw new Error("No migrations have been generated yet.");
  }
  const latest = journal.entries[journal.entries.length - 1];
  return latest.tag;
}

export interface MigrationResult {
  appliedVersion: string;
  databaseUrl: string;
}

export async function runMigrations(
  databaseUrlOverride?: string,
): Promise<MigrationResult> {
  const databaseUrl =
    databaseUrlOverride ?? process.env.BINDERSNAP_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("BINDERSNAP_DATABASE_URL is required to run migrations.");
  }

  const tag = readLatestJournalTag();

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const appliedAt = Date.now();
    await db.execute(sql`
      INSERT INTO schema_versions (id, version, applied_at)
      VALUES (1, ${tag}, ${appliedAt})
      ON CONFLICT (id) DO UPDATE SET
        version = EXCLUDED.version,
        applied_at = EXCLUDED.applied_at
    `);
    return { appliedVersion: tag, databaseUrl };
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function readCurrentVersion(
  databaseUrlOverride?: string,
): Promise<string | null> {
  const databaseUrl =
    databaseUrlOverride ?? process.env.BINDERSNAP_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "BINDERSNAP_DATABASE_URL is required to read the schema version.",
    );
  }
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const rows = await client<
      { version: string }[]
    >`SELECT version FROM schema_versions WHERE id = 1 LIMIT 1`;
    return rows[0]?.version ?? null;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "42P01"
    ) {
      // schema_versions table does not exist yet — first run
      return null;
    }
    throw err;
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isMain = import.meta.path === Bun.main;

if (isMain) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");

  if (checkOnly) {
    readCurrentVersion()
      .then((v) => {
        console.log(JSON.stringify({ currentVersion: v }));
      })
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  } else {
    runMigrations()
      .then((result) => {
        console.log(JSON.stringify({ ok: true, ...result }));
      })
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      });
  }
}
