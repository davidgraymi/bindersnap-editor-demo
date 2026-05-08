import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

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

describe("migration journal", () => {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as Journal;

  test("has at least one entry so the runner has something to apply", () => {
    expect(journal.entries.length).toBeGreaterThan(0);
  });

  test("each entry has a corresponding .sql file", () => {
    for (const entry of journal.entries) {
      const path = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      expect(readFileSync(path, "utf-8").length).toBeGreaterThan(0);
    }
  });

  test("entries are in monotonically increasing idx order", () => {
    for (let i = 0; i < journal.entries.length; i += 1) {
      expect(journal.entries[i].idx).toBe(i);
    }
  });

  test("EXPECTED_SCHEMA_VERSION matches the latest journal tag", async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import("../version");
    const latest = journal.entries[journal.entries.length - 1];
    expect(EXPECTED_SCHEMA_VERSION).toBe(latest.tag);
  });
});

describe("architectural invariant", () => {
  // The migration runner exists to keep schema changes out of the API process.
  // Enforce that nothing in services/api outside db/migrate/ imports the runner
  // or drizzle-kit. If this test fails, the migration policy has been violated.
  test("api code does not import the migration runner or drizzle-kit", () => {
    const apiRoot = join(import.meta.dir, "..", "..");
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip the migrate/ directory itself — it's allowed to import drizzle-kit.
          if (full.endsWith(`${"db"}/migrate`)) continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) continue;
        const text = readFileSync(full, "utf-8");
        if (
          /from\s+["'][^"']*db\/migrate\/run["']/.test(text) ||
          /from\s+["']drizzle-kit/.test(text) ||
          /import\s*\(\s*["'][^"']*db\/migrate\/run["']/.test(text)
        ) {
          offenders.push(full);
        }
      }
    }

    walk(apiRoot);
    expect(offenders).toEqual([]);
  });
});
