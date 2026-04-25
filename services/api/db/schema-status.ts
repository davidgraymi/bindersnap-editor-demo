import { desc, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { config } from "../config";
import { createDb } from "./client";
import { readMigrationJournal } from "./migration-journal";

const drizzleMigrations = sqliteTable("__drizzle_migrations", {
  hash: text("hash").notNull(),
  createdAt: integer("created_at", { mode: "number" }),
});

export function assertSchemaCurrent(
  path: string = config.sessionsDbPath,
): void {
  const expectedMigrations = readMigrationJournal();
  const latestExpectedMigration = expectedMigrations.at(-1);

  if (!latestExpectedMigration) {
    return;
  }

  const database = createDb(path);
  const migrationsTable = database.get<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
  );

  if (!migrationsTable) {
    throw new Error(
      `Database schema is out of date for ${path}. Run 'bun run db:migrate' before starting the API.`,
    );
  }

  const latestAppliedMigration = database
    .select({
      hash: drizzleMigrations.hash,
    })
    .from(drizzleMigrations)
    .orderBy(desc(drizzleMigrations.createdAt))
    .get();

  if (!latestAppliedMigration) {
    throw new Error(
      `Database schema is out of date for ${path}. Run 'bun run db:migrate' before starting the API.`,
    );
  }

  if (latestAppliedMigration.hash !== latestExpectedMigration.hash) {
    throw new Error(
      `Database schema is out of date for ${path}. Expected migration ${latestExpectedMigration.tag}. Run 'bun run db:migrate' before starting the API.`,
    );
  }
}
