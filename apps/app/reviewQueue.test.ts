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

test("a row names the document and the binder separately", () => {
  const [row] = buildQueueRows([binder("clinical", [change()])], "bob", NOW);

  expect(row?.binderName).toBe("Clinical");
  expect(row?.documentName).toBe("Hand Hygiene Policy");
  expect(row?.requestedBy).toBe("alice");
});

test("a change about no document is named for its binder", () => {
  // Sign-off rules touch no document; naming one would be inventing it.
  const [row] = buildQueueRows(
    [binder("clinical", [change({ documentSlugPath: null })])],
    "bob",
    NOW,
  );

  expect(row?.documentName).toBe("Clinical");
});

test("a refusing reviewer blocks the row and is named", () => {
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
  // The build's vocabulary, not the mockup's "Blocked".
  expect(row?.statusReason).toBe("carol asked for changes");
});

test("every approval in reads as ready, and says which version it becomes", () => {
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
  expect(row?.statusReason).toBe("Ready to publish");
  expect(row?.becomesVersion).toBe(2);
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
