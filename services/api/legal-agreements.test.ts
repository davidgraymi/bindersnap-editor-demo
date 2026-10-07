import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LegalAgreementStore } from "./legal-agreements";

function freshStore() {
  return new LegalAgreementStore(
    join(mkdtempSync(join(tmpdir(), "terms-")), "terms.db"),
  );
}

test("an account that never agreed has no history", () => {
  expect(freshStore().history("alice")).toEqual([]);
});

test("agreeing again adds a row, and the old one stays", () => {
  const store = freshStore();
  store.record("JKim", "2026-10-07", 1_000);
  store.record("jkim", "2027-01-15", 2_000);
  expect(store.history("JKIM")).toEqual([
    { username: "jkim", version: "2027-01-15", acceptedAt: 2_000 },
    { username: "jkim", version: "2026-10-07", acceptedAt: 1_000 },
  ]);
});
