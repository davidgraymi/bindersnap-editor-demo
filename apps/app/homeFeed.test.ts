import { expect, test } from "bun:test";

import {
  describeFeedEvent,
  describeOthers,
  feedDayLabel,
  foldFeedDay,
  groupFeedByDay,
  type FeedEvent,
} from "./homeFeed";

function event(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: 1,
    kind: "approved",
    actor: "carol",
    actorName: "Carol Mendes",
    org: "riverside-health",
    binder: "corporate",
    changeNumber: 20,
    title: "Retire the 2019 supplier terms",
    excerpt: null,
    createdAt: "2026-10-30T15:00:00",
    ...overrides,
  };
}

test("an event reads as a sentence: who, did what, to which change, where", () => {
  expect(describeFeedEvent(event())).toEqual({
    actor: "Carol Mendes",
    verb: "approved",
    subject: "Retire the 2019 supplier terms",
    binder: "Corporate",
    tone: "decision",
  });
  expect(describeFeedEvent(event({ kind: "changes_requested" }))).toMatchObject(
    { verb: "asked for changes on", tone: "blocked" },
  );
  expect(describeFeedEvent(event({ kind: "replied" }))).toMatchObject({
    verb: "replied on",
    tone: "talk",
  });
});

test("a change whose title could not be read is named by its number", () => {
  expect(describeFeedEvent(event({ title: null })).subject).toBe("change 20");
});

test("a binder being made names the binder, and no binder after it", () => {
  expect(
    describeFeedEvent(
      event({ kind: "binder_created", changeNumber: null, title: null }),
    ),
  ).toMatchObject({
    verb: "made the binder",
    subject: "Corporate",
    binder: null,
  });
});

test("days are said as somebody would say them", () => {
  const now = new Date("2026-10-31T18:00:00").getTime();
  expect(feedDayLabel("2026-10-31T09:00:00", now)).toBe("Today");
  expect(feedDayLabel("2026-10-30T23:59:00", now)).toBe("Yesterday");
  expect(feedDayLabel("2026-10-27T10:00:00", now)).toBe("Tuesday");
  expect(feedDayLabel("2026-10-12T10:00:00", now)).toBe("12 October");
  expect(feedDayLabel("2025-12-12T10:00:00", now)).toBe("12 December 2025");
});

test("the feed is a day at a time, in the order it came", () => {
  const now = new Date("2026-10-31T18:00:00").getTime();
  const days = groupFeedByDay(
    [
      event({ id: 1, createdAt: "2026-10-31T10:00:00" }),
      event({ id: 2, createdAt: "2026-10-31T09:00:00" }),
      event({ id: 3, createdAt: "2026-10-30T09:00:00" }),
    ],
    now,
  );
  expect(days.map((day) => [day.label, day.events.map((e) => e.id)])).toEqual([
    ["Today", [1, 2]],
    ["Yesterday", [3]],
  ]);
});

test("a day says each change once, leading with the decision", () => {
  const groups = foldFeedDay([
    event({ id: 5, kind: "replied", changeNumber: 20 }),
    event({ id: 4, kind: "published", changeNumber: 20 }),
    event({ id: 3, kind: "opened", changeNumber: 7, binder: "clinical" }),
    event({ id: 2, kind: "approved", changeNumber: 20 }),
    event({ id: 1, kind: "binder_created", changeNumber: null }),
  ]);
  expect(groups.map((group) => [group.lead.id, group.others])).toEqual([
    // Published outranks the reply after it and the approval before it.
    [4, 2],
    [3, 0],
    [1, 0],
  ]);
});

test("the same number in two binders is two changes", () => {
  const groups = foldFeedDay([
    event({ id: 2, changeNumber: 3, binder: "corporate" }),
    event({ id: 1, changeNumber: 3, binder: "clinical" }),
  ]);
  expect(groups).toHaveLength(2);
});

test("of two events that matter as much, the later one leads", () => {
  const [group] = foldFeedDay([
    event({ id: 2, kind: "changes_requested" }),
    event({ id: 1, kind: "approved" }),
  ]);
  expect(group!.lead.id).toBe(2);
  expect(describeOthers(group!.others)).toBe("and 1 other update");
  expect(describeOthers(0)).toBe("");
  expect(describeOthers(4)).toBe("and 4 other updates");
});
