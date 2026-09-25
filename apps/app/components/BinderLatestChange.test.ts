import { expect, test } from "bun:test";

import type { HistoryChange } from "../binderHistory";
import { describeLatestChange } from "./BinderLatestChange";

/** The card's one sentence, in the history's own words. */

function change(overrides: Partial<HistoryChange> = {}): HistoryChange {
  return {
    changeNumber: 20,
    title: "Retire the 2019 supplier terms",
    submittedBy: "bob",
    approvers: ["carol"],
    publishedAt: "2026-09-23T21:35:00Z",
    rows: [],
    ...overrides,
  };
}

test("names who published it and who approved it", () => {
  expect(describeLatestChange(change())).toBe(
    "Published by Bob · approved by Carol",
  );
});

test("names every approver, the way the history does", () => {
  expect(
    describeLatestChange(change({ approvers: ["carol", "dan", "priya"] })),
  ).toBe("Published by Bob · approved by Carol, Dan and Priya");
});

test("a tag written outside the app says only what it can", () => {
  expect(describeLatestChange(change({ submittedBy: "", approvers: [] }))).toBe(
    "No recorded approval",
  );
});
