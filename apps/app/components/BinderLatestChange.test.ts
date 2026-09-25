import { expect, test } from "bun:test";

import { describePublication, type HistoryChange } from "../binderHistory";

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
  expect(describePublication(change())).toBe(
    "Published by Bob · approved by Carol",
  );
});

test("names every approver, the way the history does", () => {
  expect(
    describePublication(change({ approvers: ["carol", "dan", "priya"] })),
  ).toBe("Published by Bob · approved by Carol, Dan and Priya");
});

test("a tag written outside the app says only what it can", () => {
  expect(describePublication(change({ submittedBy: "", approvers: [] }))).toBe(
    "No recorded approval",
  );
});

test("says what each person is called, when their names are known", () => {
  const names: Record<string, string> = {
    bob: "Bob Okafor",
    carol: "Carol Mendes",
  };
  expect(describePublication(change(), (login) => names[login] ?? login)).toBe(
    "Published by Bob Okafor · approved by Carol Mendes",
  );
});
