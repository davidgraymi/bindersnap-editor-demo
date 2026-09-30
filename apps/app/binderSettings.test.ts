import { describe, expect, test } from "bun:test";

import {
  countApprovers,
  describeTeamAccess,
  parseApprovalCount,
  unreachableApprovalsNote,
} from "./binderSettings";

test("access says what it costs, because the ADR promises reviewers are free", () => {
  // Worded without naming where it is shown: the same sentence appears on a
  // binder, beside a team granted onto it, and on the organization, beside a
  // group that may be granted onto any binder.
  expect(describeTeamAccess("admin")).toBe("Can administer · paid seat");
  expect(describeTeamAccess("write")).toBe("Can publish · paid seat");
  expect(describeTeamAccess("read")).toBe("Can review · free");
  expect(describeTeamAccess("none")).toBe("No access");
});

test("owner is a level, and the highest one", () => {
  // Gitea reports the organization's built-in Owners team as
  // `repo.code: "owner"` on every repository the org holds. A switch that only
  // knew admin/write/read called that "No access" — beside the person who owns
  // the organization — which is the very trap ADR 0004 warns about when it
  // says counting by name suffix would miss the Owners team.
  expect(describeTeamAccess("owner")).toBe("Owns the organization · paid seat");
});

describe("approval counts", () => {
  const team = (access: string, ...logins: string[]) => ({
    access,
    members: logins.map((login) => ({ login })),
  });

  test("counts each person who can approve once, reviewers included", () => {
    expect(
      countApprovers([
        team("owner", "alice"),
        team("read", "bob", "alice"),
        team("write", "carol"),
        team("none", "dan"),
      ]),
    ).toBe(3);
  });

  test("says when a change could never collect enough approvals", () => {
    expect(unreachableApprovalsNote(2, 3)).toBeNull();
    expect(unreachableApprovalsNote(0, 1)).toBeNull();
    expect(unreachableApprovalsNote(3, 3)).toBe(
      "Only 3 people can approve in this binder, and nobody approves their own change, so nothing can be published until more people join.",
    );
    expect(unreachableApprovalsNote(1, 1)).toContain("Only 1 person can");
  });

  test("reads a typed count", () => {
    expect(parseApprovalCount(" 12 ")).toBe(12);
    expect(parseApprovalCount("0")).toBe(0);
    for (const text of ["", "-1", "1.5", "two", "99999999999999999999"]) {
      expect(parseApprovalCount(text)).toBeNull();
    }
  });
});
