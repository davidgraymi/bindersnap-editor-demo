import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "./client";
import { migrationsFolder } from "./migration-journal";

export async function migrateTestDb(path: string): Promise<void> {
  await migrate(createDb(path), { migrationsFolder });
}

export async function createMigratedTestDbPath(
  prefix: string = "bindersnap-api-db-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "test.sqlite");
  await migrateTestDb(path);
  return path;
}
