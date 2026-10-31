import { describe, expect, test } from "bun:test";

import {
  approverOptions,
  countApprovers,
  countChosenApprovers,
  describeApprovers,
  approverReach,
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

describe("who approves changes", () => {
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
    handle === "staff"
      ? "Everyone"
      : handle.charAt(0).toUpperCase() + handle.slice(1);

  test("the whole organization is offered, Everyone last", () => {
    const options = approverOptions(
      ["finance", "board", "everyone"],
      [
        { login: "nurse", fullName: "Nia Nurse" },
        { login: "okafor", fullName: "" },
      ],
    );
    expect(options.groups).toEqual(["board", "finance", "Owners", "everyone"]);
    expect(options.people).toEqual([
      { login: "nurse", name: "Nia Nurse" },
      { login: "okafor", name: "okafor" },
    ]);
  });

  test("only who can read the binder can be picked", () => {
    const canPick = approverReach(teams, ["boss"]);
    expect(canPick("group", "board")).toBe(true);
    expect(canPick("group", "Owners")).toBe(true);
    expect(canPick("group", "finance")).toBe(false);
    expect(canPick("person", "Chair")).toBe(true);
    expect(canPick("person", "boss")).toBe(true);
    expect(canPick("person", "okafor")).toBe(false);
  });

  test("nobody reads as nobody yet", () => {
    expect(describeApprovers({ groups: [], people: [] }, [], title)).toBe(
      "Nobody yet",
    );
  });

  test("a choice reads as names, Everyone included", () => {
    expect(
      describeApprovers(
        { groups: ["staff"], people: ["nurse"] },
        [{ login: "nurse", name: "Nia Nurse" }],
        title,
      ),
    ).toBe("Everyone and Nia Nurse");
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
  const options = approverOptions(
    ["board-of-directors", "finance"],
    [
      { login: "nurse", fullName: "Nia Nurse" },
      { login: "okafor", fullName: "Dr. Bola Okafor" },
    ],
  );
  const title = (handle: string) =>
    handle === "everyone"
      ? "Everyone"
      : handle
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
  const none = { groups: [], people: [] };
  const canPick = (kind: "group" | "person", value: string) =>
    !(kind === "group" && value === "finance") &&
    !(kind === "person" && value === "okafor");

  test("with nothing typed, the whole organization", () => {
    expect(searchApprovers(options, "  ", none, title, canPick)).toHaveLength(
      6,
    );
  });

  test("finds groups by name and people by name or login", () => {
    const values = (query: string) =>
      searchApprovers(options, query, none, title, canPick).map((m) => m.value);
    expect(values("board")).toEqual(["board-of-directors"]);
    expect(values("dr bola")).toEqual(["okafor"]);
    expect(values("nurse")).toEqual(["nurse"]);
  });

  test("shows who has no access, after who can be picked", () => {
    const found = searchApprovers(options, "", none, title, canPick);
    expect(found.slice(-2).map((m) => [m.value, m.canPick])).toEqual([
      ["finance", false],
      ["okafor", false],
    ]);
  });

  test("leaves out what is already chosen", () => {
    expect(
      searchApprovers(
        options,
        "o",
        { groups: ["board-of-directors"], people: ["okafor"] },
        title,
        canPick,
      ).map((m) => m.value),
    ).toEqual(["Owners", "everyone"]);
  });

  test("calls the whole organization Everyone, and finds it by that name", () => {
    expect(searchApprovers(options, "everyone", none, title, canPick)).toEqual([
      { kind: "group", value: "everyone", label: "Everyone", canPick: true },
    ]);
  });
});
