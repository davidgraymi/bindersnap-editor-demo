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

/**
 * A change request opens quiet.
 *
 * **The customer saw the whole of a draft arrive as a review history:** *"the
 * conversation area is populated with all those changes… the CR is cluttered
 * as soon as it is opened."* Every act in a draft is a commit, so a draft with
 * eight acts proposed a change whose discussion already read "Alice updated
 * the proposed version" seven times, before anybody had looked at it.
 *
 * Nothing was updated. That work is what was proposed.
 */
test("everything on the branch when it opened is the submission", () => {
  const updates = buildChangeUpdates(
    [
      commit("aaa", "2026-08-19T10:00:00Z"),
      commit("bbb", "2026-08-19T10:05:00Z"),
      commit("ccc", "2026-08-19T10:09:00Z"),
    ],
    "2026-08-19T10:10:00Z",
  );

  // One update, under the branch head as it stood when reviewers were asked.
  expect(updates).toEqual([
    { index: 1, sha: "ccc", author: "maya", at: "2026-08-19T10:09:00Z" },
  ]);
});

test("a commit after it opened is the update it actually is", () => {
  const updates = buildChangeUpdates(
    [
      commit("aaa", "2026-08-19T10:00:00Z"),
      commit("bbb", "2026-08-19T10:05:00Z"),
      commit("fix", "2026-08-20T09:00:00Z"),
    ],
    "2026-08-19T10:10:00Z",
  );

  expect(updates.map((update) => [update.index, update.sha])).toEqual([
    [1, "bbb"],
    [2, "fix"],
  ]);
});

/**
 * A change opened on an empty branch and committed to afterwards.
 *
 * There is no submission to be update 1, so the first thing committed is —
 * which keeps "update 2 of 2" meaning what it says rather than starting at
 * two.
 */
test("with nothing on the branch yet, the first commit is update 1", () => {
  const updates = buildChangeUpdates(
    [
      commit("aaa", "2026-08-20T09:00:00Z"),
      commit("bbb", "2026-08-20T10:00:00Z"),
    ],
    "2026-08-19T10:10:00Z",
  );

  expect(updates.map((update) => [update.index, update.sha])).toEqual([
    [1, "aaa"],
    [2, "bbb"],
  ]);
});

/**
 * An unreadable timestamp is part of the submission, not an update.
 *
 * Both mistakes are available and they are not equally bad: saying somebody
 * revised a change they never touched is a claim about a person on a record
 * product. Saying nothing is not.
 */
test("a commit with no readable date is counted as submitted", () => {
  const updates = buildChangeUpdates(
    [commit("aaa", "2026-08-19T10:00:00Z"), commit("bbb", "not-a-date")],
    "2026-08-19T10:10:00Z",
  );

  expect(updates).toHaveLength(1);
});

/** No date to compare against is the old behaviour, unchanged. */
test("without an opening date every commit still counts", () => {
  const updates = buildChangeUpdates([
    commit("aaa", "2026-08-19T10:00:00Z"),
    commit("bbb", "2026-08-19T10:05:00Z"),
  ]);

  expect(updates).toHaveLength(2);
});
