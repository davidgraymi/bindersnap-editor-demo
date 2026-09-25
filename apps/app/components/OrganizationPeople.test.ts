import { describe, expect, test } from "bun:test";

import { describePersonGroups } from "./OrganizationPeople";

describe("describePersonGroups", () => {
  test("says so when a person is in no group", () => {
    expect(describePersonGroups([])).toBe("In no group yet");
  });

  test("names up to three groups", () => {
    expect(describePersonGroups(["legal", "quality-committee"])).toBe(
      "Legal · Quality Committee",
    );
  });

  test("counts the rest past three, in the singular for one", () => {
    expect(describePersonGroups(["a", "b", "c", "d"])).toMatch(
      / and 1 more group$/,
    );
    expect(describePersonGroups(["a", "b", "c", "d", "e"])).toMatch(
      / and 2 more groups$/,
    );
  });
});
