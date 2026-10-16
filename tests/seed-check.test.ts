import { expect, test } from "bun:test";

import {
  expectedOnMain,
  expectedOutcome,
  standingRequestForWork,
} from "./seed";
import type { SeedBinder, SeedChange } from "./seed-scenario";

function change(overrides: Partial<SeedChange> = {}): SeedChange {
  return {
    branch: "upload/x",
    title: "A change",
    summary: "",
    document: { title: "A", sections: [] },
    reviews: [],
    threads: [],
    reviewers: [],
    publish: false,
    closed: false,
    ...overrides,
  };
}

test("a published change reads as published, an untouched one as open", () => {
  expect(expectedOutcome(change({ publish: true }))).toBe("published");
  expect(expectedOutcome(change())).toBe("open");
});

test("closed with work still asked for is declined; without, withdrawn", () => {
  const sentBack = change({
    closed: true,
    reviews: [{ by: "bob", state: "changes_requested", body: "No." }],
  });
  expect(expectedOutcome(sentBack)).toBe("declined");
  expect(expectedOutcome(change({ closed: true }))).toBe("withdrawn");
});

test("a later approval takes back the same person's request for work", () => {
  expect(
    standingRequestForWork(
      change({
        reviews: [
          { by: "bob", state: "changes_requested", body: "No." },
          { by: "bob", state: "approved", body: "Yes." },
        ],
      }),
    ),
  ).toBe(false);
});

test("a comment does not take back a request for work", () => {
  expect(
    standingRequestForWork(
      change({
        reviews: [
          { by: "bob", state: "changes_requested", body: "No." },
          { by: "bob", state: "commented", body: "Still no." },
        ],
      }),
    ),
  ).toBe(true);
});

test("a document is on main once one of its changes is published", () => {
  const binder = {
    documents: [
      { name: "a", folder: "x", changes: [change({ publish: true })] },
      { name: "b", changes: [change()] },
      { name: "c", folder: "old", changes: [change({ publish: true })] },
    ],
    changes: [
      {
        ...change(),
        acts: [{ kind: "renameFolder", from: "old", to: "new" }],
      },
    ],
  } as unknown as SeedBinder;

  expect([...expectedOnMain(binder)]).toEqual([
    ["x/a", true],
    ["b", false],
  ]);
});
