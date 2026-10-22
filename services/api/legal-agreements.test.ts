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
  const store = freshStore();
  expect(store.history("alice")).toEqual([]);
  expect(store.latestPersonVersion("alice")).toBeNull();
});

test("agreeing again adds a row, and the old one stays", () => {
  const store = freshStore();
  store.record({ username: "JKim", userId: 7, version: "2026-10-07" }, 1_000);
  store.record({ username: "jkim", userId: 7, version: "2027-01-15" }, 2_000);
  expect(store.history("JKIM")).toEqual([
    {
      username: "jkim",
      userId: 7,
      version: "2027-01-15",
      acceptedAt: 2_000,
      scope: "person",
      organizationId: null,
      organizationName: null,
    },
    {
      username: "jkim",
      userId: 7,
      version: "2026-10-07",
      acceptedAt: 1_000,
      scope: "person",
      organizationId: null,
      organizationName: null,
    },
  ]);
  expect(store.latestPersonVersion("jkim")).toBe("2027-01-15");
});

test("accepting for an organization is its own record, not the person's", () => {
  const store = freshStore();
  store.record({
    username: "alice",
    userId: 1,
    version: "2026-10-07",
    organization: { id: 42, name: "riverside" },
  });
  expect(store.latestPersonVersion("alice")).toBeNull();
  expect(store.latestOrganizationVersion(42)).toBe("2026-10-07");
  expect(store.latestOrganizationVersion(43)).toBeNull();
  expect(store.history("alice")[0]).toMatchObject({
    scope: "organization",
    organizationId: 42,
    organizationName: "riverside",
  });
});

test("an organization's acceptance holds whichever owner gave it", () => {
  const store = freshStore();
  store.record({
    username: "alice",
    userId: 1,
    version: "2026-10-07",
    organization: { id: 42, name: "riverside" },
  });
  store.record({
    username: "bob",
    userId: 2,
    version: "2027-01-15",
    organization: { id: 42, name: "riverside" },
  });
  expect(store.latestOrganizationVersion(42)).toBe("2027-01-15");
});
