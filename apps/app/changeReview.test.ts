import { expect, test } from "bun:test";

import {
  buildProposedVersionFacts,
  describeChangeBody,
  buildReviewTimeline,
  buildThreadFacts,
  describeChangeOpening,
  formatEventDate,
  resolveReviewDecision,
} from "./changeReview";
import type { ChangeRecord } from "./documentDisplay";

const author = (login: string, fullName = "") => ({
  login,
  fullName,
  avatarUrl: "",
});

function change(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    number: 4,
    summary: "Updated liability clause",
    description: "Legal asked us to cap liability at 12 months of fees.",
    reviews: [],
    branchName: "upload/v4",
    submittedBy: "maya",
    submittedAt: "2026-08-20T09:14:00Z",
    open: true,
    approvalState: "in_review",
    outcome: null,
    closedAt: null,
    decidedBy: null,
    publishedVersion: null,
    assignee: null,
    reviewers: [],
    approvalCount: 2,
    requiredApprovals: 3,
    ...overrides,
  };
}

function thread(overrides: Partial<any> = {}) {
  return {
    id: "t1",
    origin: "bindersnap" as const,
    comments: [
      {
        id: 1,
        threadId: "t1",
        author: author("tom", "Tom Ward"),
        body: "Does the cap include indemnification claims?",
        createdAt: "2026-08-20T10:00:00Z",
        updatedAt: "2026-08-20T10:00:00Z",
        htmlUrl: "",
        reactions: [],
      },
    ],
    events: [],
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

const review = (overrides: Partial<any> = {}) => ({
  id: 11,
  author: author("priya", "Priya Shah"),
  state: "approved" as const,
  body: "Matches what legal sent over.",
  submittedAt: "2026-08-21T12:00:00Z",
  stale: false,
  dismissed: false,
  ...overrides,
});

const update = (
  index: number,
  sha: string,
  at: string,
  name = "Maya Khan",
) => ({
  index,
  sha,
  author: name,
  at,
});

// --- the header ------------------------------------------------------------

test("the opening line names the submitter and the version it becomes", () => {
  expect(describeChangeOpening(change(), 4)).toEqual({
    who: "Maya",
    when: "Aug 20, 2026",
    becomes: 4,
  });
});

test("a closed change no longer becomes anything", () => {
  expect(describeChangeOpening(change({ open: false }), 4).becomes).toBeNull();
});

test("a description that only repeats the title is not shown twice", () => {
  expect(
    describeChangeBody("Updated liability clause", "Updated liability clause"),
  ).toBeNull();
  expect(describeChangeBody("Updated liability clause", "  ")).toBeNull();
});

test("a description that says something new is kept", () => {
  expect(
    describeChangeBody("Updated liability clause", "Legal asked for a cap."),
  ).toBe("Legal asked for a cap.");
});

// --- the proposed version card --------------------------------------------

test("one update needs no update count", () => {
  const facts = buildProposedVersionFacts({
    fileName: "vendor-agreement.docx",
    branchName: "upload/v4",
    submittedAt: "2026-08-20T09:14:00Z",
    updates: [update(1, "aaa", "2026-08-20T09:14:00Z")],
  });

  expect(facts.updateLabel).toBeNull();
  expect(facts.hasHistory).toBe(false);
  expect(facts.fileName).toBe("vendor-agreement.docx");
  expect(facts.date).toBe("Aug 20");
});

test("a corrected change says which update is on show", () => {
  const facts = buildProposedVersionFacts({
    fileName: "vendor-agreement.docx",
    branchName: "upload/v4",
    submittedAt: "2026-08-20T09:14:00Z",
    updates: [
      update(1, "aaa", "2026-08-20T09:14:00Z"),
      update(2, "bbb", "2026-08-21T15:00:00Z"),
    ],
  });

  expect(facts.updateLabel).toBe("update 2 of 2");
  expect(facts.hasHistory).toBe(true);
  expect(facts.date).toBe("Aug 21");
});

test("with no updates loaded the card still names the file and the date", () => {
  const facts = buildProposedVersionFacts({
    fileName: null,
    branchName: "upload/v4",
    submittedAt: "2026-08-20T09:14:00Z",
    updates: [],
  });

  expect(facts.fileName).toBe("The submitted file");
  expect(facts.updateLabel).toBeNull();
  expect(facts.date).toBe("Aug 20");
  expect(facts.ref).toBe("upload/v4");
});

// --- threads ---------------------------------------------------------------

test("a lone comment is not collapsible — there is nothing to hide", () => {
  const facts = buildThreadFacts(thread(), false);

  expect(facts.collapsible).toBe(false);
  expect(facts.replyCount).toBe(0);
  expect(facts.resolutionNote).toBeNull();
});

test("a reply makes it a thread, and the toggle counts the replies", () => {
  const withReply = thread({
    comments: [
      ...thread().comments,
      {
        id: 2,
        threadId: "t1",
        author: author("maya", "Maya Khan"),
        body: "Only direct damages.",
        createdAt: "2026-08-21T09:00:00Z",
        updatedAt: "2026-08-21T09:00:00Z",
        htmlUrl: "",
        reactions: [],
      },
    ],
  });

  expect(buildThreadFacts(withReply, true).toggleLabel).toBe("Show 1 reply");
  expect(buildThreadFacts(withReply, false).toggleLabel).toBe("Collapse");
  expect(buildThreadFacts(withReply, false).collapsible).toBe(true);
});

test("resolution is logged inside the thread, and says it can be undone", () => {
  const resolved = thread({
    resolved: true,
    resolvedBy: author("priya", "Priya Shah"),
    resolvedAt: "2026-08-21T11:00:00Z",
    events: [
      {
        id: 9,
        actor: author("priya", "Priya Shah"),
        resolved: true,
        at: "2026-08-21T11:00:00Z",
      },
    ],
  });

  expect(buildThreadFacts(resolved, true).resolutionNote).toBe(
    "Priya Shah marked this as resolved · Aug 21 · a new comment reopens it",
  );
});

test("a reopened thread carries no resolution note", () => {
  const reopened = thread({
    resolved: false,
    events: [
      {
        id: 9,
        actor: author("priya", "Priya Shah"),
        resolved: true,
        at: "2026-08-21T11:00:00Z",
      },
    ],
  });

  expect(buildThreadFacts(reopened, false).resolutionNote).toBeNull();
});

// --- the timeline ----------------------------------------------------------

test("the timeline opens with the change being opened", () => {
  const entries = buildReviewTimeline({
    change: change(),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  expect(entries).toHaveLength(1);
  expect(entries[0]?.kind).toBe("opened");
  expect(entries[0]?.event?.actor).toBe("Maya");
  expect(entries[0]?.event?.verb).toBe("opened this change request");
});

test("update 1 is the opening, not an update event", () => {
  const entries = buildReviewTimeline({
    change: change(),
    threads: [],
    updates: [
      update(1, "aaa", "2026-08-20T09:14:00Z"),
      update(2, "bbb", "2026-08-21T15:00:00Z"),
    ],
    resetsApprovals: true,
  });

  const updates = entries.filter((entry) => entry.kind === "update");
  expect(updates).toHaveLength(1);
  expect(updates[0]?.event?.tag).toBe("(update 2)");
  expect(updates[0]?.event?.note).toBe("earlier approvals were reset");
  expect(updates[0]?.event?.updateSha).toBe("bbb");
});

test("an update says nothing about approvals when the document keeps them", () => {
  const entries = buildReviewTimeline({
    change: change(),
    threads: [],
    updates: [
      update(1, "aaa", "2026-08-20T09:14:00Z"),
      update(2, "bbb", "2026-08-21T15:00:00Z"),
    ],
    resetsApprovals: false,
  });

  expect(
    entries.find((entry) => entry.kind === "update")?.event?.note,
  ).toBeNull();
});

test("everything is ordered by when it happened", () => {
  const entries = buildReviewTimeline({
    change: change({
      reviews: [review({ submittedAt: "2026-08-22T09:00:00Z" })],
    }),
    threads: [thread({ createdAt: "2026-08-20T10:00:00Z" })],
    updates: [
      update(1, "aaa", "2026-08-20T09:14:00Z"),
      update(2, "bbb", "2026-08-21T15:00:00Z"),
    ],
    resetsApprovals: false,
  });

  expect(entries.map((entry) => entry.kind)).toEqual([
    "opened",
    "thread",
    "update",
    "approved",
  ]);
});

test("an approval is the loud row: the verb carries the emphasis", () => {
  const entries = buildReviewTimeline({
    change: change({ reviews: [review()] }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  const approval = entries.find((entry) => entry.kind === "approved");
  expect(approval?.event?.actor).toBe("Priya Shah");
  expect(approval?.event?.emphasiseVerb).toBe(true);
  expect(approval?.event?.note).toBe('"Matches what legal sent over."');
});

test("an approval whose body is just the state word is not quoted back", () => {
  const entries = buildReviewTimeline({
    change: change({ reviews: [review({ body: "APPROVED" })] }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  expect(
    entries.find((entry) => entry.kind === "approved")?.event?.note,
  ).toBeNull();
});

test("a superseded approval still appears, and says it no longer counts", () => {
  const entries = buildReviewTimeline({
    change: change({ reviews: [review({ body: "", stale: true })] }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  expect(entries.find((entry) => entry.kind === "approved")?.event?.note).toBe(
    "superseded by a later update",
  );
});

test("a request for changes is its own kind of row", () => {
  const entries = buildReviewTimeline({
    change: change({
      reviews: [review({ state: "changes_requested", body: "Fix 9.1." })],
    }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  const asked = entries.find((entry) => entry.kind === "changes");
  expect(asked?.event?.verb).toBe("asked for changes");
  expect(asked?.event?.emphasiseVerb).toBe(false);
});

test("a published change ends with how it ended", () => {
  const entries = buildReviewTimeline({
    change: change({
      open: false,
      outcome: "published",
      decidedBy: "alice",
      publishedVersion: 4,
      closedAt: "2026-08-23T09:00:00Z",
      reviews: [review()],
    }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  const last = entries[entries.length - 1];
  expect(last?.kind).toBe("closed");
  expect(last?.event?.actor).toBe("Alice");
  expect(last?.event?.verb).toBe("published this as v4");
});

test("a withdrawn change says so rather than just closing", () => {
  const entries = buildReviewTimeline({
    change: change({
      open: false,
      outcome: "withdrawn",
      closedAt: "2026-08-23T09:00:00Z",
    }),
    threads: [],
    updates: [],
    resetsApprovals: false,
  });

  expect(entries[entries.length - 1]?.event?.verb).toBe("withdrew this change");
});

// --- the decision ----------------------------------------------------------

test("publish replaces approve once the approvals are in", () => {
  expect(
    resolveReviewDecision({
      open: true,
      isAnonymous: false,
      ownSubmission: false,
      mergeReady: true,
      canReview: true,
      canMerge: true,
    }),
  ).toBe("publish");
});

test("your own change is not yours to approve", () => {
  expect(
    resolveReviewDecision({
      open: true,
      isAnonymous: false,
      ownSubmission: true,
      mergeReady: false,
      canReview: true,
      canMerge: true,
    }),
  ).toBe("none");
});

test("you can publish your own change once it is approved", () => {
  expect(
    resolveReviewDecision({
      open: true,
      isAnonymous: false,
      ownSubmission: true,
      mergeReady: true,
      canReview: false,
      canMerge: true,
    }),
  ).toBe("publish");
});

test("an approved change can still be objected to by someone who cannot publish", () => {
  expect(
    resolveReviewDecision({
      open: true,
      isAnonymous: false,
      ownSubmission: false,
      mergeReady: true,
      canReview: true,
      canMerge: false,
    }),
  ).toBe("review");
});

test("a closed change has no decision left, and neither has a visitor", () => {
  const settled = {
    ownSubmission: false,
    mergeReady: false,
    canReview: true,
    canMerge: true,
  };
  expect(
    resolveReviewDecision({ ...settled, open: false, isAnonymous: false }),
  ).toBe("none");
  expect(
    resolveReviewDecision({ ...settled, open: true, isAnonymous: true }),
  ).toBe("none");
});

// --- dates -----------------------------------------------------------------

test("an unparseable date renders as nothing rather than 'Invalid Date'", () => {
  expect(formatEventDate("not-a-date")).toBe("");
  expect(formatEventDate("")).toBe("");
});
