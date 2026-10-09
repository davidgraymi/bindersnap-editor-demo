import { describe, expect, test } from "bun:test";

import { copyName } from "./copyName";

describe("copyName", () => {
  test("the first copy says so", () => {
    expect(copyName("Hand Hygiene", ["Hand Hygiene"])).toBe(
      "Hand Hygiene Copy",
    );
  });

  test("a taken name counts up, whatever its case", () => {
    expect(
      copyName("Hand Hygiene", ["Hand Hygiene", "hand hygiene COPY"]),
    ).toBe("Hand Hygiene Copy 2");
  });

  test("a copy of a copy is a copy of the original", () => {
    expect(
      copyName("Hand Hygiene Copy", ["Hand Hygiene", "Hand Hygiene Copy"]),
    ).toBe("Hand Hygiene Copy 2");
  });
});
