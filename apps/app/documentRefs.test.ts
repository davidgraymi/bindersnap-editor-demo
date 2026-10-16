import { describe, expect, test } from "bun:test";

import { buildReadableRefs, currentRef } from "./documentRefs";

const CHANGES = [
  {
    number: 12,
    title: "Bring hand hygiene in line with PPE",
    branchName: "draft/alice/20260922",
  },
  {
    number: 9,
    title: "Retire the old handover form",
    branchName: "draft/bob/20260901",
  },
];

describe("buildReadableRefs", () => {
  test("the record is first, and is where you are when the address says nothing", () => {
    const refs = buildReadableRefs({
      openChanges: [],
      ref: null,
      change: null,
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]!.label).toBe("On the record");
    expect(refs[0]!.current).toBe(true);
  });

  test("a ref spelled `main` is the record, not a second entry beside it", () => {
    // The page reads there either way. An address that spells it out would
    // otherwise produce a picker offering the record twice.
    const refs = buildReadableRefs({
      openChanges: [],
      ref: "main",
      change: null,
    });

    expect(refs).toHaveLength(1);
    expect(currentRef(refs).label).toBe("On the record");
  });

  test("every open change touching the document is on offer", () => {
    const refs = buildReadableRefs({
      openChanges: CHANGES,
      ref: null,
      change: null,
    });

    expect(refs.map((entry) => entry.label)).toEqual([
      "On the record",
      "Change #12",
      "Change #9",
    ]);
    // The line under it is what the change is asking for — the reader's
    // question is "which proposal", and a branch name answers it for nobody.
    expect(refs[1]!.detail).toBe("Bring hand hygiene in line with PPE");
  });

  test("the record is still offered while you are reading a proposal", () => {
    // A picker whose list drops the record is one you cannot use to answer
    // "what does this policy say today", which is what a proposal makes urgent.
    const refs = buildReadableRefs({
      openChanges: CHANGES,
      ref: null,
      change: 12,
    });

    expect(refs[0]!.label).toBe("On the record");
    expect(refs[0]!.current).toBe(false);
    expect(currentRef(refs).label).toBe("Change #12");
  });

  test("the branch alone marks where you are, without a change number", () => {
    // The explorer's rows carry a ref and not always a change, so a reader who
    // clicked through the tree is still on the change they started from.
    const refs = buildReadableRefs({
      openChanges: CHANGES,
      ref: "draft/bob/20260901",
      change: null,
    });

    expect(currentRef(refs).label).toBe("Change #9");
  });

  test("a draft nobody has proposed is somewhere you can be", () => {
    // Edit mode reads on a branch belonging to no change. Without this the
    // control would say "On the record" over a page that is not the record.
    const refs = buildReadableRefs({
      openChanges: CHANGES,
      ref: "draft/carol/20260923",
      change: null,
    });

    expect(currentRef(refs).label).toBe("Your draft");
    expect(currentRef(refs).detail).toBe("Not proposed yet");
    expect(refs[0]!.current).toBe(false);
  });

  test("a change the document detail did not list is still where you are", () => {
    const refs = buildReadableRefs({ openChanges: [], ref: null, change: 44 });

    expect(currentRef(refs).label).toBe("Change #44");
    expect(currentRef(refs).change).toBe(44);
  });

  test("nothing anywhere says branch", () => {
    // The whole point. A reader of a policy manual has no reason to know that
    // a change request is a branch.
    const refs = buildReadableRefs({
      openChanges: CHANGES,
      ref: "draft/alice/20260922",
      change: 12,
    });

    for (const entry of refs) {
      expect(`${entry.label} ${entry.detail}`.toLowerCase()).not.toContain(
        "branch",
      );
    }
  });
});
