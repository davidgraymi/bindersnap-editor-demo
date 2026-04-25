import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RawMigrationJournalEntry {
  tag: string;
  when: number;
}

interface RawMigrationJournal {
  entries?: RawMigrationJournalEntry[];
}

export interface MigrationJournalEntry {
  createdAt: number;
  hash: string;
  sqlPath: string;
  tag: string;
}

export const migrationsFolder = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "migrations",
);

export function readMigrationJournal(): MigrationJournalEntry[] {
  const journalPath = resolve(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(
    readFileSync(journalPath, "utf8"),
  ) as RawMigrationJournal;

  return (journal.entries ?? []).map((entry) => {
    const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const hash = createHash("sha256")
      .update(readFileSync(sqlPath, "utf8"))
      .digest("hex");

    return {
      createdAt: entry.when,
      hash,
      sqlPath,
      tag: entry.tag,
    };
  });
}
