import { describe, expect, test } from "bun:test";

import {
  branchEditTarget,
  ownsDraftBranch,
  policyToWriteInChange,
} from "./branchEdit";

const changes = [
  {
    number: 21,
    branchName: "draft/alice/20261112T090000",
    viewerCanEdit: true,
  },
  {
    number: 18,
    branchName: "draft/omar/20261101T090000",
    viewerCanEdit: false,
  },
];

describe("branchEditTarget", () => {
  test("the record edits in your draft", () => {
    expect(branchEditTarget(null, "alice", null)).toEqual({ kind: "record" });
  });

  test("your own draft, proposed or not, is edited in place", () => {
    expect(
      branchEditTarget("draft/alice/20261112T090000", "alice", null),
    ).toEqual({ kind: "draft", branch: "draft/alice/20261112T090000" });
  });

  test("a change you co-edit is edited in the change", () => {
    expect(
      branchEditTarget("draft/alice/20261112T090000", "bob", changes),
    ).toEqual({
      kind: "change",
      number: 21,
      branch: "draft/alice/20261112T090000",
    });
  });

  test("somebody else's change is theirs", () => {
    expect(
      branchEditTarget("draft/omar/20261101T090000", "bob", changes),
    ).toEqual({ kind: "theirs", number: 18 });
    expect(branchEditTarget("upload/x/1/2", "bob", changes)).toEqual({
      kind: "theirs",
      number: null,
    });
  });

  test("unknown until the open changes are read", () => {
    expect(branchEditTarget("draft/omar/1", "bob", null)).toEqual({
      kind: "unknown",
    });
  });
});

describe("ownsDraftBranch", () => {
  test("reads the owner from the branch name", () => {
    expect(ownsDraftBranch("draft/alice/1", "alice")).toBe(true);
    expect(ownsDraftBranch("draft/alice/1", "bob")).toBe(false);
    expect(ownsDraftBranch("draft/alice", "alice")).toBe(false);
    expect(ownsDraftBranch("shape/alice/1", "alice")).toBe(false);
  });
});

describe("policyToWriteInChange", () => {
  const documents = [
    { path: "a.01A.json", slugPath: "a" },
    { path: "hr/b.01B.json", slugPath: "hr/b" },
    { path: "hr/c.01C.json", slugPath: "hr/c" },
    { path: "hr/d.01D.docx", slugPath: "hr/d" },
  ];

  test("prefers what the change touches, in the folder", () => {
    expect(policyToWriteInChange(documents, ["hr/c", "a"], "hr")).toBe("hr/c");
    expect(policyToWriteInChange(documents, ["hr/c"], null)).toBe("hr/c");
  });

  test("else the first the editor writes there", () => {
    expect(policyToWriteInChange(documents, [], "hr")).toBe("hr/b");
    expect(policyToWriteInChange(documents, [], null)).toBe("a");
  });

  test("none in a folder of Word files", () => {
    expect(
      policyToWriteInChange(
        [{ path: "x/d.01D.docx", slugPath: "x/d" }],
        ["x/d"],
        "x",
      ),
    ).toBeNull();
  });
});
