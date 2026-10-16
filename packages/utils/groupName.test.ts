import { describe, expect, test } from "bun:test";

import {
  MAX_GROUP_NAME_LENGTH,
  describeGroupName,
  slugifyGroupName,
} from "./groupName";

describe("slugifyGroupName", () => {
  test("turns what a customer types into a handle", () => {
    expect(slugifyGroupName("Quality Committee")).toBe("quality-committee");
    expect(slugifyGroupName("Infection Control")).toBe("infection-control");
  });

  test("drops the characters CODEOWNERS cannot carry", () => {
    // `@org/team` is parsed by splitting on whitespace, so a space in a group
    // name is a rule nobody can reference. Dots and slashes go for the same
    // reason: the fewer characters a generated rule can hold, the fewer ways
    // it can be misread.
    expect(slugifyGroupName("Q1 (2026) Review / Board")).toBe(
      "q1-2026-review-board",
    );
    expect(slugifyGroupName("policy.owners")).toBe("policy-owners");
  });

  test("never starts, ends or doubles a dash", () => {
    expect(slugifyGroupName("  --Nursing Leads--  ")).toBe("nursing-leads");
    expect(slugifyGroupName("!!!")).toBe("");
  });

  test("stays inside Gitea's length limit and does not end mid-separator", () => {
    const handle = slugifyGroupName("a".repeat(MAX_GROUP_NAME_LENGTH) + " b");
    expect(handle.length).toBeLessThanOrEqual(MAX_GROUP_NAME_LENGTH);
    expect(handle.endsWith("-")).toBe(false);
  });
});

describe("describeGroupName", () => {
  test("says a handle the way a person would", () => {
    expect(describeGroupName("quality-committee")).toBe("Quality Committee");
    expect(describeGroupName("staff")).toBe("Staff");
  });

  test("leaves Gitea's own spelling alone", () => {
    // Owners is how that team is spelled in Gitea, in our code and in the ADR.
    // Re-spelling it would make one team look like two.
    expect(describeGroupName("Owners")).toBe("Owners");
  });

  test("survives a name it did not make", () => {
    expect(describeGroupName("")).toBe("");
    expect(describeGroupName("clinical_policies.reviewers")).toBe(
      "Clinical Policies Reviewers",
    );
  });
});
