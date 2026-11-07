import { describe, expect, test } from "bun:test";

import { blankDocument, untitledName } from "./newDocument";

describe("untitledName", () => {
  test("is Untitled when the folder has none", () => {
    expect(untitledName(["Hand Hygiene"])).toBe("Untitled");
  });

  test("counts on past the ones taken, ignoring case", () => {
    expect(untitledName(["untitled", "Untitled 2"])).toBe("Untitled 3");
  });
});

describe("blankDocument", () => {
  test("is an editor document with one empty paragraph", () => {
    expect(JSON.parse(blankDocument())).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});
