import { expect, test } from "bun:test";

import type { MyDraft } from "../../packages/api-schema/schemas/workspaces";
import { buildHomeTasks, describeHomeTasks } from "./homeTasks";
import type { QueueRow } from "./reviewQueue";

const NOW = Date.parse("2026-11-12T12:00:00Z");

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    key: `riverside-health/corporate#${overrides.number ?? 1}`,
    owner: "riverside-health",
    repo: "corporate",
    number: 1,
    title: "A change",
    binderName: "Corporate",
    meta: "#1 · Carol Mendes opened 2 hours ago",
    status: "in_review",
    section: "in_review",
    standing: "Awaiting approval",
    tone: "waiting",
    commentCount: 0,
    mine: false,
    movedAt: NOW,
    ...overrides,
  } as QueueRow;
}

function draft(overrides: Partial<MyDraft> = {}): MyDraft {
  return {
    organization: "riverside-health",
    workspace: "clinical",
    branch: "draft/alice/1",
    name: "Draft of 12 November",
    named: false,
    owner: "alice",
    updatedAt: "2026-11-12T10:00:00Z",
    changeNumber: null,
    documentCount: 2,
    acts: [],
    ...overrides,
  } as MyDraft;
}

test("a change you were asked to review is yours, whoever proposed it", () => {
  const [task] = buildHomeTasks(
    [row({ section: "your_review", title: "Subsistence rates" })],
    [],
    NOW,
  );
  expect(task).toEqual({
    key: "change:riverside-health/corporate#1",
    kind: "review",
    title: "Subsistence rates",
    detail: "Your review was asked for · Corporate",
    action: "Review",
    href: "/riverside-health/corporate/-/changes/1",
  });
});

test("your own change sent back or approved is yours to move", () => {
  const tasks = buildHomeTasks(
    [
      row({ number: 2, mine: true, section: "ready" }),
      row({ number: 3, mine: true, section: "changes_requested" }),
    ],
    [],
    NOW,
  );
  expect(tasks.map((task) => [task.kind, task.action, task.detail])).toEqual([
    ["revise", "Revise", "Changes were asked for · Corporate"],
    ["publish", "Publish", "Approved · Corporate"],
  ]);
});

test("somebody else's move is not on your list", () => {
  expect(
    buildHomeTasks(
      [
        // Sent back to its author, approved for its author, or still with
        // its reviewers: none of these is waiting on the reader.
        row({ number: 4, section: "changes_requested" }),
        row({ number: 5, section: "ready" }),
        row({ number: 6, section: "in_review" }),
        row({ number: 7, mine: true, section: "in_review" }),
      ],
      [],
      NOW,
    ),
  ).toEqual([]);
});

test("a draft is listed while it has work in it and is not proposed", () => {
  const tasks = buildHomeTasks(
    [],
    [
      draft(),
      draft({ branch: "draft/alice/2", documentCount: 0 }),
      draft({ branch: "draft/alice/3", changeNumber: 9 }),
    ],
    NOW,
  );
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    kind: "draft",
    title: "Draft of 12 November",
    detail: "Draft, not proposed yet · Clinical · edited 2 hours ago",
    action: "Continue",
  });
  expect(tasks[0]!.href).toContain("draft=");
});

test("reviews come first, then revising, publishing and drafts", () => {
  const tasks = buildHomeTasks(
    [
      row({ number: 1, mine: true, section: "ready" }),
      row({ number: 2, section: "your_review", movedAt: NOW - 1000 }),
      row({ number: 3, mine: true, section: "changes_requested" }),
      row({ number: 4, section: "your_review", movedAt: NOW }),
    ],
    [draft()],
    NOW,
  );
  expect(tasks.map((task) => task.key.split("#")[1] ?? task.kind)).toEqual([
    // Within a kind, what moved last is first.
    "4",
    "2",
    "3",
    "1",
    "draft",
  ]);
});

test("the line under the greeting counts what is waiting", () => {
  expect(describeHomeTasks(0)).toBe("Nothing is waiting on you.");
  expect(describeHomeTasks(1)).toBe("1 thing is waiting on you.");
  expect(describeHomeTasks(6)).toBe("6 things are waiting on you.");
});
