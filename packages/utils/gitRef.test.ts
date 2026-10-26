import { describe, expect, test } from "bun:test";

import { isCommitRef, versionRef } from "./gitRef";

const SHA1 = "0be6a65b18248f5c31eb93afe1f700c9550f4e7f";
const SHA256 =
  "4f2c1d9b0e6a7c3f8b5d2e1a9c7f6b3d0e8a5c2f1b9d7e4a6c3f0b8d5e2a1c9f";

describe("isCommitRef", () => {
  test("a full SHA-1 or SHA-256 commit id is one", () => {
    expect(isCommitRef(SHA1)).toBe(true);
    expect(isCommitRef(SHA1.toUpperCase())).toBe(true);
    expect(isCommitRef(SHA256)).toBe(true);
  });

  test("a branch, a tag, main or a short hash is not", () => {
    for (const ref of [
      "main",
      "draft/alice/20260927",
      "01J8XZ4K7M0000000000000000/v3",
      "v3",
      SHA1.slice(0, 12),
      `${SHA1}0`,
      "",
    ]) {
      expect(isCommitRef(ref)).toBe(false);
    }
  });
});

describe("versionRef", () => {
  test("a version is read at its commit when the server named it", () => {
    expect(versionRef({ tag: "01J8/v3", commitSha: SHA1 })).toBe(SHA1);
  });

  test("and at its tag when it did not", () => {
    expect(versionRef({ tag: "01J8/v3", commitSha: "" })).toBe("01J8/v3");
  });
});
