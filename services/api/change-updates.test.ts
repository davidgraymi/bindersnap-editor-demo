import { expect, test } from "bun:test";

import { buildChangeUpdates } from "./change-updates";

const commit = (sha: string, timestamp: string, author = "maya") => ({
  sha,
  author,
  timestamp,
});

test("numbers updates oldest first", () => {
  const updates = buildChangeUpdates([
    commit("ccc", "2026-08-21T10:00:00Z"),
    commit("aaa", "2026-08-19T10:00:00Z"),
    commit("bbb", "2026-08-20T10:00:00Z"),
  ]);

  expect(updates.map((update) => [update.index, update.sha])).toEqual([
    [1, "aaa"],
    [2, "bbb"],
    [3, "ccc"],
  ]);
});

test("the original submission is update 1", () => {
  const updates = buildChangeUpdates([commit("aaa", "2026-08-19T10:00:00Z")]);

  expect(updates).toHaveLength(1);
  expect(updates[0]?.index).toBe(1);
});

test("carries the author and timestamp through", () => {
  const updates = buildChangeUpdates([
    commit("aaa", "2026-08-19T10:00:00Z", "Maya Khan"),
  ]);

  expect(updates[0]).toEqual({
    index: 1,
    sha: "aaa",
    author: "Maya Khan",
    at: "2026-08-19T10:00:00Z",
  });
});

test("drops a commit with no sha rather than numbering it", () => {
  const updates = buildChangeUpdates([
    commit("", "2026-08-19T10:00:00Z"),
    commit("bbb", "2026-08-20T10:00:00Z"),
  ]);

  expect(updates).toEqual([
    { index: 1, sha: "bbb", author: "maya", at: "2026-08-20T10:00:00Z" },
  ]);
});

test("an unparseable timestamp does not reorder the rest", () => {
  const updates = buildChangeUpdates([
    commit("bbb", "2026-08-20T10:00:00Z"),
    commit("aaa", "not-a-date"),
  ]);

  expect(updates.map((update) => update.sha)).toEqual(["aaa", "bbb"]);
});

test("no commits is no updates, not an error", () => {
  expect(buildChangeUpdates([])).toEqual([]);
});
