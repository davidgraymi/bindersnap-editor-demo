import { expect, test } from "bun:test";

import {
  countVersions,
  describeApprovers,
  filterHistory,
  groupHistoryByChange,
  historyPolicies,
} from "./binderHistory";
import type { WorkspaceHistoryEntry } from "../../packages/api-schema/schemas/workspaces";

function entry(
  overrides: Partial<WorkspaceHistoryEntry> &
    Pick<WorkspaceHistoryEntry, "slugPath" | "tag">,
): WorkspaceHistoryEntry {
  const cut = overrides.slugPath.lastIndexOf("/");
  return {
    kind: "version",
    name: cut === -1 ? overrides.slugPath : overrides.slugPath.slice(cut + 1),
    folder: cut === -1 ? "" : overrides.slugPath.slice(0, cut),
    version: 1,
    commitSha: "sha",
    publishedAt: "2026-09-15T12:00:00Z",
    changeNumber: 3,
    changeTitle: "Move the infection policies into Nursing",
    submittedBy: "alice",
    approvers: ["bob"],
    ...overrides,
  };
}

test("one change that published three policies is one entry", () => {
  // The shape ADR 0004 exists for, and the one the old page could not draw:
  // three cross-referencing policies revised and approved as one act.
  const changes = groupHistoryByChange([
    entry({ slugPath: "nursing/infection-control", tag: "a/v1" }),
    entry({ slugPath: "nursing/hand-hygiene", tag: "b/v4", version: 4 }),
    entry({
      slugPath: "administrative/paper-charts",
      tag: "c/archived-1",
      kind: "archived",
      version: null,
    }),
  ]);

  expect(changes).toHaveLength(1);
  expect(changes[0]!.changeNumber).toBe(3);
  expect(changes[0]!.rows.map((row) => [row.slugPath, row.kind])).toEqual([
    ["nursing/hand-hygiene", "version"],
    ["nursing/infection-control", "version"],
    // What a change archived comes after what it published.
    ["administrative/paper-charts", "archived"],
  ]);
});

test("the spine runs newest change first", () => {
  const changes = groupHistoryByChange([
    entry({
      slugPath: "training/hipaa",
      tag: "d/v2",
      changeNumber: 2,
      publishedAt: "2026-04-02T09:14:00Z",
    }),
    entry({
      slugPath: "administrative/grievance",
      tag: "e/v1",
      changeNumber: 7,
      publishedAt: "2026-09-15T13:03:00Z",
    }),
  ]);

  expect(changes.map((change) => change.changeNumber)).toEqual([7, 2]);
});

test("a tag written outside Bindersnap is its own entry, not lumped in", () => {
  // A binder is a git repository and somebody may tag it by hand. That is a
  // fact about the record rather than a fault to hide.
  const changes = groupHistoryByChange([
    entry({ slugPath: "nursing/handover", tag: "f/v1", changeNumber: null }),
    entry({ slugPath: "nursing/handover", tag: "f/v2", changeNumber: null }),
  ]);

  expect(changes).toHaveLength(2);
});

test("picking a policy keeps the changes that touched it, whole", () => {
  const changes = groupHistoryByChange([
    entry({ slugPath: "nursing/infection-control", tag: "a/v1" }),
    entry({ slugPath: "nursing/hand-hygiene", tag: "b/v4", version: 4 }),
    entry({
      slugPath: "training/hipaa",
      tag: "d/v2",
      changeNumber: 2,
      publishedAt: "2026-04-02T09:14:00Z",
    }),
  ]);

  const filtered = filterHistory(changes, { slugPath: "nursing/hand-hygiene" });
  expect(filtered).toHaveLength(1);
  // Everything that change did stays on the entry: a version published
  // alongside this one is part of what happened to it.
  expect(filtered[0]!.rows).toHaveLength(2);
});

test("a date range cuts the spine, and keeps an entry with no date", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const changes = groupHistoryByChange([
    entry({ slugPath: "a", tag: "a/v1", changeNumber: 7 }),
    entry({
      slugPath: "b",
      tag: "b/v1",
      changeNumber: 2,
      publishedAt: "2025-04-02T09:14:00Z",
    }),
    entry({ slugPath: "c", tag: "c/v1", changeNumber: 9, publishedAt: "" }),
  ]);

  expect(
    filterHistory(changes, { since: "90days" }, now).map((c) => c.changeNumber),
  ).toEqual([7, 9]);
  expect(filterHistory(changes, { since: "all" }, now)).toHaveLength(3);
});

test("the picker lists every policy the history mentions, archived ones too", () => {
  expect(
    historyPolicies([
      entry({ slugPath: "nursing/handover", tag: "a/v2", version: 2 }),
      entry({ slugPath: "nursing/handover", tag: "a/v1" }),
      entry({
        slugPath: "administrative/paper-charts",
        tag: "c/archived-1",
        kind: "archived",
        version: null,
      }),
    ]).map((policy) => policy.slugPath),
  ).toEqual(["administrative/paper-charts", "nursing/handover"]);
});

test("the count is of versions published, not of rows", () => {
  const changes = groupHistoryByChange([
    entry({ slugPath: "a", tag: "a/v1" }),
    entry({
      slugPath: "b",
      tag: "b/archived-1",
      kind: "archived",
      version: null,
    }),
  ]);
  expect(countVersions(changes)).toBe(1);
});

test("approvers are named, and nobody is said rather than shown blank", () => {
  expect(describeApprovers([])).toBe("no recorded approval");
  expect(describeApprovers(["Bob Okafor"])).toBe("approved by Bob Okafor");
  expect(describeApprovers(["Bob Okafor", "Priya Raman"])).toBe(
    "approved by Bob Okafor and Priya Raman",
  );
});
