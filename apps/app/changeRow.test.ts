import { expect, test } from "bun:test";

import { describeChangeMeta, describeChangeStandingWord } from "./changeRow";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

const change = (
  over: Partial<Parameters<typeof describeChangeMeta>[0]> = {},
) => ({
  number: 4,
  submittedBy: "alice",
  submittedAt: hoursAgo(2),
  approvalCount: 0,
  requiredApprovals: 1,
  ...over,
});

// ── the line under the title ───────────────────────────────────────

test("a change nobody has touched says when it opened", () => {
  expect(describeChangeMeta(change(), NOW)).toBe(
    "#4 · Alice opened 2 hours ago",
  );
});

/**
 * A list of changes is read for "what has happened lately", and a row that
 * only ever reports when something opened cannot answer that.
 */
test("a change that has moved says when it last moved", () => {
  expect(
    describeChangeMeta(
      change({ submittedAt: hoursAgo(48), updatedAt: hoursAgo(1) }),
      NOW,
    ),
  ).toBe("#4 · Alice · updated 1 hour ago");
});

/**
 * A change is always saved a moment after it is created, and "updated 0
 * minutes ago" about that is noise rather than news.
 */
test("a save a moment after opening is not an update", () => {
  const opened = hoursAgo(2);
  const meta = describeChangeMeta(
    {
      ...change({ submittedAt: opened }),
      updatedAt: new Date(Date.parse(opened) + 5_000).toISOString(),
    },
    NOW,
  );
  expect(meta).toContain("opened");
});

// ── where it stands, in one word ───────────────────────────────────

test("a change still collecting sign-offs is awaiting approval", () => {
  const facts = describeChangeStandingWord(change());
  expect(facts.standing).toBe("Awaiting approval");
  expect(facts.tone).toBe("awaiting");
});

/**
 * **"Waiting on you" is not a standing**, it is a statement about the reader —
 * and it was printed on changes that were approved and ready, which is what
 * the customer caught: *"why does a CR say 'Waiting on you' when it's approved
 * to be published?"*
 */
test("a change with every approval is approved", () => {
  const facts = describeChangeStandingWord(
    change({ approvalCount: 1, requiredApprovals: 1 }),
  );
  expect(facts.standing).toBe("Approved");
  expect(facts.tone).toBe("approved");
});

/**
 * Worst news first. A change with every approval and a reviewer asking for
 * changes cannot publish, and reporting "Approved" for it would be a lie a
 * reader would act on.
 */
test("a refusal outranks a full count", () => {
  const facts = describeChangeStandingWord(
    change({ approvalCount: 1, requiredApprovals: 1, isRejected: true }),
  );
  expect(facts.standing).toBe("Changes requested");
  expect(facts.tone).toBe("changes");
});

test("a decided change says how it ended", () => {
  expect(describeChangeStandingWord(change({ outcome: "published" }))).toEqual({
    standing: "Published",
    tone: "published",
  });
  expect(describeChangeStandingWord(change({ outcome: "declined" }))).toEqual({
    standing: "Declined",
    tone: "closed",
  });
  expect(describeChangeStandingWord(change({ outcome: "withdrawn" }))).toEqual({
    standing: "Withdrawn",
    tone: "closed",
  });
});

/** A binder that demands no approvals has nothing to collect, and says so. */
test("a binder that demands no approvals is still awaiting one", () => {
  expect(
    describeChangeStandingWord(change({ requiredApprovals: 0 })).standing,
  ).toBe("Awaiting approval");
});
