import { describe, expect, test } from "bun:test";

import {
  approverOptions,
  countApprovers,
  countChosenApprovers,
  describeApprovers,
  noApproversNote,
  describeTeamAccess,
  searchApprovers,
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

describe("whose approvals count", () => {
  const teams = [
    {
      name: "staff",
      access: "read",
      members: [
        { login: "nurse", fullName: "Nia Nurse" },
        { login: "chair", fullName: "Cam Chair" },
      ],
    },
    {
      name: "board",
      access: "read",
      members: [
        { login: "chair", fullName: "Cam Chair" },
        { login: "treasurer", fullName: "" },
      ],
    },
  ];
  const title = (handle: string) =>
    handle.charAt(0).toUpperCase() + handle.slice(1);

  test("offers every group in the organization, Owners, and everyone last", () => {
    // Naming a group gives it access, so it need not have any yet.
    expect(approverOptions(teams, ["finance"]).groups).toEqual([
      "board",
      "finance",
      "Owners",
      "staff",
    ]);
  });

  test("offers only people who can already read the binder, once each", () => {
    expect(approverOptions(teams).people).toEqual([
      { login: "chair", name: "Cam Chair" },
      { login: "nurse", name: "Nia Nurse" },
      { login: "treasurer", name: "treasurer" },
    ]);
  });

  test("nobody reads as nobody yet", () => {
    expect(describeApprovers({ groups: [], people: [] }, teams, title)).toBe(
      "Nobody yet",
    );
  });

  test("a choice reads as names", () => {
    expect(
      describeApprovers({ groups: ["board"], people: ["nurse"] }, teams, title),
    ).toBe("Board and Nia Nurse");
  });

  test("the warning counts only the people whose approvals count", () => {
    expect(countChosenApprovers({ groups: ["board"], people: [] }, teams)).toBe(
      2,
    );
    expect(countChosenApprovers(null, teams)).toBe(0);
  });

  test("approvals needed and nobody to give them is said", () => {
    const none = { groups: [], people: [] };
    expect(noApproversNote(1, none)).toContain("Nobody can approve");
    expect(noApproversNote(0, none)).toBeNull();
    expect(noApproversNote(1, { groups: ["board"], people: [] })).toBeNull();
  });
});

describe("searching for approvers", () => {
  const options = approverOptions([
    {
      name: "staff",
      members: [
        { login: "nurse", fullName: "Nia Nurse" },
        { login: "okafor", fullName: "Dr. Bola Okafor" },
      ],
    },
    { name: "board-of-directors", members: [] },
  ]);
  const title = (handle: string) =>
    handle
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  const none = { groups: [], people: [] };

  test("finds nothing until something is typed", () => {
    expect(searchApprovers(options, "  ", none, title)).toEqual([]);
  });

  test("finds groups by name and people by name or login", () => {
    expect(
      searchApprovers(options, "board", none, title).map((m) => m.value),
    ).toEqual(["board-of-directors"]);
    expect(
      searchApprovers(options, "dr bola", none, title).map((m) => m.value),
    ).toEqual(["okafor"]);
    expect(
      searchApprovers(options, "nurse", none, title).map((m) => m.value),
    ).toEqual(["nurse"]);
  });

  test("leaves out what is already chosen", () => {
    expect(
      searchApprovers(
        options,
        "o",
        { groups: ["board-of-directors"], people: ["okafor"] },
        title,
      ).map((m) => m.value),
    ).toEqual(["Owners", "staff"]);
  });

  test("calls staff everyone, and finds it by that name", () => {
    expect(searchApprovers(options, "everyone", none, title)).toEqual([
      { kind: "group", value: "staff", label: "Everyone at the organization" },
    ]);
  });
});
