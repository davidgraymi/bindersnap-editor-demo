import { expect, test } from "bun:test";

import { toFoundChanges } from "./change-search";
import type { components } from "./gitea-client/spec/gitea";

type Issue = components["schemas"]["Issue"];

function issue(
  number: number,
  overrides: Partial<Issue> & { owner?: string; merged?: boolean } = {},
): Issue {
  const { owner = "riverside-health", merged = false, ...rest } = overrides;
  return {
    number,
    title: `Change ${number}`,
    state: "open",
    repository: { owner, name: "clinical", full_name: `${owner}/clinical` },
    pull_request: { merged },
    user: { login: "carol", full_name: "Carol Mendes" },
    updated_at: "2026-10-30T10:00:00Z",
    ...rest,
  } as Issue;
}

const ORGS = new Set(["riverside-health"]);

test("a change says where it is, what it is called, and how it stands", () => {
  expect(
    toFoundChanges(
      [
        issue(1),
        issue(2, { state: "closed", merged: true }),
        issue(3, { state: "closed" }),
      ],
      ORGS,
      10,
    ).map((change) => [change.number, change.state, change.author]),
  ).toEqual([
    [1, "open", "Carol Mendes"],
    [2, "published", "Carol Mendes"],
    [3, "closed", "Carol Mendes"],
  ]);
});

test("only pull requests in your organizations, up to the limit", () => {
  const found = toFoundChanges(
    [
      issue(1, { owner: "someone-else" }),
      issue(2, { pull_request: undefined }),
      issue(3),
      issue(4),
      issue(5),
    ],
    ORGS,
    2,
  );
  expect(found.map((change) => change.number)).toEqual([3, 4]);
});
