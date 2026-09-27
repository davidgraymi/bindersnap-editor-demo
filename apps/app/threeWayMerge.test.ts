import { describe, expect, test } from "bun:test";

import {
  applyChoices,
  base64ToText,
  countConflicts,
  mergeThreeWay,
  sameBlock,
  splitLines,
  textToBase64,
} from "./threeWayMerge";

const merged = (base: string, ours: string, theirs: string) =>
  mergeThreeWay(base.split(""), ours.split(""), theirs.split(""));

describe("the three-way merge", () => {
  test("a change on one side lands without asking", () => {
    const chunks = merged("abc", "aXc", "abc");
    expect(countConflicts(chunks)).toBe(0);
    expect(applyChoices(chunks, [])?.join("")).toBe("aXc");
  });

  test("changes to different parts both land", () => {
    const chunks = merged("abcde", "aXcde", "abcdY");
    expect(countConflicts(chunks)).toBe(0);
    expect(applyChoices(chunks, [])?.join("")).toBe("aXcdY");
  });

  test("the same change on both sides lands once", () => {
    const chunks = merged("abc", "aXc", "aXc");
    expect(countConflicts(chunks)).toBe(0);
    expect(applyChoices(chunks, [])?.join("")).toBe("aXc");
  });

  test("two different changes to the same part are a conflict, with all three versions", () => {
    const chunks = merged("abc", "aXc", "aYc");
    expect(chunks).toEqual([
      { kind: "settled", items: ["a"] },
      { kind: "conflict", base: ["b"], ours: ["X"], theirs: ["Y"] },
      { kind: "settled", items: ["c"] },
    ]);
  });

  test("each conflict is decided on its own", () => {
    const chunks = merged("abc", "XbZ", "YbW");
    expect(countConflicts(chunks)).toBe(2);
    expect(applyChoices(chunks, ["ours", "theirs"])?.join("")).toBe("XbW");
    expect(applyChoices(chunks, ["both", "neither"])?.join("")).toBe("XYb");
    // An undecided conflict has no result yet.
    expect(applyChoices(chunks, ["ours", null])).toBeNull();
  });

  test("additions at the end from both sides conflict, and Both keeps the change's first", () => {
    const chunks = merged("a", "aX", "aY");
    expect(countConflicts(chunks)).toBe(1);
    expect(applyChoices(chunks, ["both"])?.join("")).toBe("aXY");
  });

  test("a document both sides added asks only where they differ", () => {
    // No base: diff3 alone makes the whole document one conflict.
    const chunks = merged("", "TaXc", "TaYc");
    expect(chunks).toEqual([
      { kind: "settled", items: ["T", "a"] },
      { kind: "conflict", base: [], ours: ["X"], theirs: ["Y"] },
      { kind: "settled", items: ["c"] },
    ]);
    expect(applyChoices(chunks, ["theirs"])?.join("")).toBe("TaYc");
  });

  test("what both sides of a conflict share settles between the clashes", () => {
    // Both rewrote a and b, and both added the same s between them.
    const split = merged("ab", "XsZb", "YsWb");
    expect(countConflicts(split)).toBe(2);
    expect(applyChoices(split, ["ours", "theirs"])?.join("")).toBe("XsWb");
  });

  test("a removal against an edit is a conflict", () => {
    const chunks = merged("abc", "ac", "aYc");
    expect(chunks[1]).toEqual({
      kind: "conflict",
      base: ["b"],
      ours: [],
      theirs: ["Y"],
    });
  });

  test("empty inputs", () => {
    expect(mergeThreeWay([], [], [])).toEqual([]);
    expect(applyChoices(mergeThreeWay([], ["a"], []), [])).toEqual(["a"]);
  });

  test("blocks are compared by their JSON, marks and all", () => {
    const heading = { type: "heading", attrs: { level: 1 } };
    const bold = {
      type: "paragraph",
      content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }],
    };
    const plain = { type: "paragraph", content: [{ type: "text", text: "x" }] };
    expect(sameBlock(heading, { ...heading })).toBe(true);
    expect(sameBlock(bold, plain)).toBe(false);

    const chunks = mergeThreeWay(
      [heading, plain],
      [heading, bold],
      [heading, plain],
      sameBlock,
    );
    expect(applyChoices(chunks, [])).toEqual([heading, bold]);
  });
});

describe("text and bytes", () => {
  test("lines split and a file's text survives base64 both ways", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b", ""]);
    const text = "Hand hygiene — § 4.2, café\n";
    expect(base64ToText(textToBase64(text))).toBe(text);
  });
});
