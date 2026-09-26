import { expect, test } from "bun:test";

import type { HomeOpenDocument } from "./api";
import {
  buildQueueRows,
  countQueueRows,
  describeQueue,
  filterQueueRows,
  initialQueueFilter,
} from "./reviewQueue";

type PendingPR = HomeOpenDocument["pendingPRs"][number];
type Reviewer = PendingPR["reviewers"][number];

const NOW = Date.parse("2026-09-09T12:00:00Z");

function reviewer(
  login: string,
  status: Reviewer["status"],
  extra: Partial<Reviewer> = {},
): Reviewer {
  return {
    login,
    fullName: login,
    status,
    reviewedAt: status === "awaiting" ? "" : "2026-09-09T10:00:00Z",
    stale: false,
    requested: true,
    ...extra,
  } as Reviewer;
}

function change(overrides: Partial<PendingPR> = {}): PendingPR {
  return {
    id: 1,
    number: 1,
    title: "A change",
    state: "open",
    created: "2026-09-09T09:00:00Z",
    created_at: "2026-09-09T09:00:00Z",
    updated_at: "2026-09-09T11:00:00Z",
    branchName: "upload/nursing/hand-hygiene/20260909/alice",
    approvalCount: 0,
    requiredApprovals: 1,
    isApproved: false,
    isRejected: false,
    reviewers: [],
    body: "Tighter hand hygiene auditing.",
    user: { login: "alice" },
    documentSlugPath: "nursing/hand-hygiene-policy.docx",
    nextVersion: 2,
    ...overrides,
  } as PendingPR;
}

function binder(
  name: string,
  pendingPRs: PendingPR[],
  owner = "riverside-health",
): HomeOpenDocument {
  return {
    repo: { name, owner: { login: owner } },
    pendingPRs,
    error: null,
  } as HomeOpenDocument;
}

/**
 * **The row says four things and no more.**
 *
 * It used to carry the document it touches, who requested it, an approval
 * count, a sentence naming whoever was holding it up, and the version it would
 * become — beside a separate "Waiting on you" flag. The customer counted the
 * words: *"That is WAYYY too much text. KEEP IT STUPID SIMPLE."*
 *
 * The document is gone from it for a reason of its own: a change can touch
 * three, and naming one of them is a claim about the other two.
 */
test("a row says which binder, who opened it, and when", () => {
  const [row] = buildQueueRows([binder("clinical", [change()])], "bob", NOW);

  expect(row?.binderName).toBe("Clinical");
  expect(row?.meta).toContain("#1");
  expect(row?.meta).toContain("Alice");
  // The document it touches is not on the row: a change can touch three.
  expect(row?.meta).not.toContain("Hand Hygiene");
});

/**
 * Worst news first: a refusal outranks a full count, because a change with
 * every approval and a reviewer asking for changes cannot publish — and
 * reporting "Approved" for it would be a lie a reader would act on.
 */
test("a refusing reviewer is a change that needs changes", () => {
  const [row] = buildQueueRows(
    [
      binder("clinical", [
        change({
          reviewers: [reviewer("carol", "changes_requested")],
        }),
      ]),
    ],
    "alice",
    NOW,
  );

  expect(row?.status).toBe("blocked");
  expect(row?.standing).toBe("Changes requested");
  expect(row?.tone).toBe("changes");
});

/**
 * **"Approved", not "Ready to publish · becomes v2".**
 *
 * Which version it becomes is a fact about a document, and belongs on the
 * change's own page where there is room to name each one.
 */
test("every approval in reads as approved, in one word", () => {
  const [row] = buildQueueRows(
    [
      binder("clinical", [
        change({
          approvalCount: 1,
          requiredApprovals: 1,
          reviewers: [reviewer("bob", "approved")],
        }),
      ]),
    ],
    "alice",
    NOW,
  );

  expect(row?.status).toBe("ready");
  expect(row?.standing).toBe("Approved");
  expect(row?.tone).toBe("approved");
});

test("a requested reviewer who has not answered is waiting on", () => {
  const rows = buildQueueRows(
    [
      binder("clinical", [
        change({ reviewers: [reviewer("bob", "awaiting")] }),
      ]),
    ],
    "bob",
    NOW,
  );

  expect(rows[0]?.waitingOnYou).toBe(true);

  // And not for anybody else.
  const others = buildQueueRows(
    [
      binder("clinical", [
        change({ reviewers: [reviewer("bob", "awaiting")] }),
      ]),
    ],
    "carol",
    NOW,
  );
  expect(others[0]?.waitingOnYou).toBe(false);
});

test("a reviewer who already answered is no longer waiting on", () => {
  const rows = buildQueueRows(
    [
      binder("clinical", [
        change({ reviewers: [reviewer("bob", "commented")] }),
      ]),
    ],
    "bob",
    NOW,
  );

  expect(rows[0]?.waitingOnYou).toBe(false);
});

test("a ready change waits on whoever can publish it", () => {
  const ready = change({
    approvalCount: 1,
    requiredApprovals: 1,
    reviewers: [reviewer("bob", "approved")],
    user: { login: "alice" },
  });

  // The submitter can publish it.
  expect(
    buildQueueRows([binder("clinical", [ready])], "alice", NOW)[0]
      ?.waitingOnYou,
  ).toBe(true);

  // A reviewer who already approved cannot, and is not waiting on.
  expect(
    buildQueueRows([binder("clinical", [ready])], "bob", NOW)[0]?.waitingOnYou,
  ).toBe(false);
});

test("a change can be blocked and waiting on you at once", () => {
  // Both facts are true and neither is safe to hide, which is why waitingOnYou
  // cuts across status rather than being one of its values.
  const [row] = buildQueueRows(
    [
      binder("clinical", [
        change({
          reviewers: [
            reviewer("carol", "changes_requested"),
            reviewer("bob", "awaiting"),
          ],
        }),
      ]),
    ],
    "bob",
    NOW,
  );

  expect(row?.status).toBe("blocked");
  expect(row?.waitingOnYou).toBe(true);
});

test("rows span binders and sort by what moved last", () => {
  const rows = buildQueueRows(
    [
      binder("clinical", [
        change({ number: 1, updated_at: "2026-09-09T09:00:00Z" }),
      ]),
      binder("corporate", [
        change({ number: 2, updated_at: "2026-09-09T11:30:00Z" }),
      ]),
    ],
    "alice",
    NOW,
  );

  expect(rows).toHaveLength(2);
  expect(rows[0]?.binderName).toBe("Corporate");
  expect(rows[1]?.binderName).toBe("Clinical");
});

test("nothing is dropped — the queue keeps changes Home would not show", () => {
  // Home drops a change the reader has nothing to do with. The queue is not a
  // to-do list, so it keeps it; that is the whole difference between them.
  const rows = buildQueueRows(
    [binder("clinical", [change({ user: { login: "carol" }, reviewers: [] })])],
    "dan",
    NOW,
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]?.waitingOnYou).toBe(false);
});

test("counts break the queue down, and waiting cuts across", () => {
  const rows = buildQueueRows(
    [
      binder("clinical", [
        change({ number: 1, reviewers: [reviewer("bob", "awaiting")] }),
        change({
          number: 2,
          reviewers: [reviewer("carol", "changes_requested")],
        }),
        change({
          number: 3,
          approvalCount: 1,
          requiredApprovals: 1,
          reviewers: [reviewer("carol", "approved")],
          user: { login: "bob" },
        }),
      ]),
    ],
    "bob",
    NOW,
  );

  const counts = countQueueRows(rows);
  expect(counts.all).toBe(3);
  expect(counts.in_review).toBe(1);
  expect(counts.blocked).toBe(1);
  expect(counts.ready).toBe(1);
  // Two of the three want something from Bob: the one he owes a review on and
  // the one he can publish. The three statuses partition; waiting does not.
  expect(counts.waiting).toBe(2);
});

test("filtering returns what the count promised", () => {
  const rows = buildQueueRows(
    [
      binder("clinical", [
        change({ number: 1, reviewers: [reviewer("bob", "awaiting")] }),
        change({
          number: 2,
          reviewers: [reviewer("carol", "changes_requested")],
        }),
      ]),
    ],
    "bob",
    NOW,
  );
  const counts = countQueueRows(rows);

  for (const filter of [
    "all",
    "waiting",
    "in_review",
    "ready",
    "blocked",
  ] as const) {
    expect(filterQueueRows(rows, filter)).toHaveLength(counts[filter]);
  }
});

test("the queue describes itself without lying about an empty desk", () => {
  expect(
    describeQueue({ all: 0, waiting: 0, in_review: 0, ready: 0, blocked: 0 }),
  ).toBe("Nothing is in flight right now.");
  expect(
    describeQueue({ all: 1, waiting: 0, in_review: 1, ready: 0, blocked: 0 }),
  ).toBe("1 change in flight. None of them is waiting on you.");
  expect(
    describeQueue({ all: 4, waiting: 2, in_review: 2, ready: 1, blocked: 1 }),
  ).toBe("4 changes in flight · 2 waiting on you.");
});

test("the page opens on the reader's own work, or on everything", () => {
  expect(
    initialQueueFilter({
      all: 4,
      waiting: 2,
      in_review: 2,
      ready: 1,
      blocked: 1,
    }),
  ).toBe("waiting");
  // Opening on an empty "waiting on you" would read as an empty product.
  expect(
    initialQueueFilter({
      all: 4,
      waiting: 0,
      in_review: 4,
      ready: 0,
      blocked: 0,
    }),
  ).toBe("all");
});

/** Your own name on every row of your own work is noise. */
test("your own change says You, and somebody else's says their name", () => {
  const [mine] = buildQueueRows([binder("clinical", [change()])], "alice", NOW);
  expect(mine?.meta).toBe("#1 · You · updated 1 hour ago");

  const named = change();
  named.user = { login: "alice", full_name: "Alice Nguyen" };
  const [theirs] = buildQueueRows([binder("clinical", [named])], "bob", NOW);
  expect(theirs?.meta).toBe("#1 · Alice Nguyen · updated 1 hour ago");
});
