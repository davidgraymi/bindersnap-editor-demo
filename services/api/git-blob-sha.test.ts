import { expect, test } from "bun:test";

import { gitBlobSha } from "./server";

test("a file's blob SHA is git's own, so it matches what a tree lists", () => {
  // `printf hello | git hash-object --stdin`
  expect(gitBlobSha(new TextEncoder().encode("hello").buffer)).toBe(
    "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",
  );
  // `git hash-object /dev/null`
  expect(gitBlobSha(new ArrayBuffer(0))).toBe(
    "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
  );
});
