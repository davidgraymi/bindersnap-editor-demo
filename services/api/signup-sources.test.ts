import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SignupSourceStore } from "./signup-sources";

function freshStore() {
  return new SignupSourceStore(
    join(mkdtempSync(join(tmpdir(), "signup-sources-")), "sources.db"),
  );
}

test("a signup's source is kept beside the account, cleaned", () => {
  const store = freshStore();
  store.record(
    "JKim",
    {
      entryPath: "/glossary/statement-of-deficiencies",
      fromPath: "/pricing",
      referrerHost: "www.google.com",
      utmSource: "jordan@example.com",
      email: "jordan@example.com",
    },
    false,
    1_000,
  );
  expect(store.get("jkim")).toEqual({
    username: "jkim",
    entryPath: "/glossary/statement-of-deficiencies",
    fromPath: "/pricing",
    referrerHost: "www.google.com",
    invited: false,
    createdAt: 1_000,
  });
});

test("a signup with nothing to say still has a row, and the first one stands", () => {
  const store = freshStore();
  store.record("alice", undefined, true, 1_000);
  store.record("alice", { entryPath: "/templates" }, false, 2_000);
  expect(store.get("alice")).toEqual({
    username: "alice",
    invited: true,
    createdAt: 1_000,
  });
});

test("deleting the account deletes its row", () => {
  const store = freshStore();
  store.record("alice", { entryPath: "/" }, false);
  store.forget("ALICE");
  expect(store.get("alice")).toBeNull();
});
