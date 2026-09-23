import { expect, test } from "bun:test";

import { requiredReviewersFor } from "./requiredReviewers";

const RULES = [
  {
    scope: "folder" as const,
    target: "nursing",
    teams: ["infection-control"],
    users: ["priya"],
  },
];
const PATHS = ["nursing/hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.md"];

test("a user code owner blocks under either gate", () => {
  // Their request is official, so the officialness gate holds it — and the
  // code-owner gate ignores officialness and holds it too.
  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: PATHS,
      gate: { officialBlocks: true, codeownersBlock: false },
    }).users,
  ).toEqual(["priya"]);

  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: PATHS,
      gate: { officialBlocks: false, codeownersBlock: true },
    }).users,
  ).toEqual(["priya"]);
});

test("a team code owner blocks only under block_on_codeowner_reviews", () => {
  // Gitea writes the team's review request and then clears its own `official`
  // flag (`AddTeamReviewRequest`, still true on 28.0.0), so under the
  // officialness gate the team holds nothing.
  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: PATHS,
      gate: { officialBlocks: true, codeownersBlock: false },
    }).teams,
  ).toEqual([]);

  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: PATHS,
      gate: { officialBlocks: false, codeownersBlock: true },
    }).teams,
  ).toEqual(["infection-control"]);
});

test("a binder holding nothing marks nobody", () => {
  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: PATHS,
      gate: { officialBlocks: false, codeownersBlock: false },
    }),
  ).toEqual({ users: [], teams: [] });
});

test("a gate that could not be read marks nobody", () => {
  // A "Required" that is wrong on a compliance product is worse than none, so
  // the failure mode is the quiet one.
  expect(
    requiredReviewersFor({ rules: RULES, paths: PATHS, gate: null }),
  ).toEqual({ users: [], teams: [] });
});

test("a rule that does not match the change puts nobody on it", () => {
  expect(
    requiredReviewersFor({
      rules: RULES,
      paths: ["training/hipaa.01J9.md"],
      gate: { officialBlocks: true, codeownersBlock: true },
    }),
  ).toEqual({ users: [], teams: [] });
});
