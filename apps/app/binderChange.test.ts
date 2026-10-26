import { expect, test } from "bun:test";

import type { WorkspaceChangeDetailPayload } from "../../packages/api-schema/schemas/workspaces";
import {
  binderChangeDetailToRecord,
  describeChangedDocument,
  describeMove,
  parseRequestedChange,
} from "./binderChange";
import { buildReviewTimeline } from "./changeReview";

const newDocument = {
  path: "nursing/hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.md",
  slugPath: "nursing/hand-hygiene",
  name: "hand-hygiene",
  uid: "01J8XZ4K7MQ9V3B0RN7YHS2E1D",
  folder: "nursing",
  size: 10,
  sha: "abc",
  nextVersion: 1,
  currentVersion: null,
  versions: [],
  previousSlugPath: null,
  restored: false,
};

const revision = {
  ...newDocument,
  nextVersion: 3,
  currentVersion: {
    tag: "01J8XZ4K7MQ9V3B0RN7YHS2E1D/v2",
    version: 2,
    commitSha: "bbb",
    publishedAt: "",
  },
  versions: [
    {
      tag: "01J8XZ4K7MQ9V3B0RN7YHS2E1D/v2",
      version: 2,
      commitSha: "bbb",
      publishedAt: "",
    },
    {
      tag: "01J8XZ4K7MQ9V3B0RN7YHS2E1D/v1",
      version: 1,
      commitSha: "aaa",
      publishedAt: "",
    },
  ],
};

// ── the change in the address bar ──────────────────────────────────

test("no change in the query means the binder itself", () => {
  expect(parseRequestedChange("")).toBeNull();
  expect(parseRequestedChange("?version=2")).toBeNull();
});

test("a change in the query is read as a number", () => {
  expect(parseRequestedChange("?change=7")).toBe(7);
});

test("a change that is not a positive whole number is ignored", () => {
  for (const search of [
    "?change=0",
    "?change=-2",
    "?change=x",
    "?change=1.5",
  ]) {
    expect(parseRequestedChange(search)).toBeNull();
  }
});

// ── what the change would do, document by document ────────────────

test("a revision names both versions, so the step is visible", () => {
  const facts = describeChangedDocument(revision);
  expect(facts.title).toBe("Hand Hygiene");
  expect(facts.effect).toBe("v2 → v3");
  // The address, not the file path: the identity segment is minted by the
  // server and read by nobody.
  expect(facts.address).toBe("nursing/hand-hygiene");
});

test("a document being added says it is new rather than showing v0", () => {
  expect(describeChangedDocument(newDocument).effect).toBe("New — becomes v1");
});

/**
 * Once the change is decided the arrow is a lie: the version on record *is*
 * what this change wrote, and the next one belongs to somebody else's change.
 */
test("a decided change names what it published", () => {
  expect(describeChangedDocument(revision, true).effect).toBe("Published v2");
  expect(describeChangedDocument(newDocument, true).effect).toBe("Added");
});

/**
 * **A rename is a change even when not a word of the document changed.** The
 * identity survives a rename and the address does not (ADR 0005), so two
 * versions of a renamed policy read identically — and the comparison reported
 * "nothing changed" about a change that plainly did something.
 */
test("a renamed document says what it was called", () => {
  expect(
    describeMove({ ...revision, previousSlugPath: "nursing/handwashing" }),
  ).toBe("Renamed from Handwashing");
});

/** Refiling and renaming are different acts to the person reading. */
test("a moved document says where it came from", () => {
  expect(
    describeMove({ ...revision, previousSlugPath: "clinical/hand-hygiene" }),
  ).toBe("Moved from Clinical");
});

test("moved out of a folder to the top level says so", () => {
  expect(
    describeMove({
      ...revision,
      slugPath: "hand-hygiene",
      previousSlugPath: "nursing/hand-hygiene",
    }),
  ).toBe("Moved from Nursing");
});

test("renamed and moved at once says both", () => {
  expect(
    describeMove({ ...revision, previousSlugPath: "clinical/handwashing" }),
  ).toBe("Renamed from Handwashing and moved from Clinical");
});

test("a document filed where it always was says nothing", () => {
  expect(describeMove(revision)).toBeNull();
  expect(
    describeMove({ ...revision, previousSlugPath: revision.slugPath }),
  ).toBeNull();
});

// --- a decided change's record ----------------------------------------------

function changeDetail(
  overrides: Partial<WorkspaceChangeDetailPayload> = {},
): WorkspaceChangeDetailPayload {
  return {
    organization: "acme",
    workspace: "policies",
    change: {
      id: 1,
      number: 7,
      title: "Update hand hygiene",
      state: "closed",
      created: "2026-09-01T10:00:00Z",
      created_at: "2026-09-01T10:00:00Z",
      branchName: "bindersnap/drafts/bob/hand-hygiene",
      approvalCount: 1,
      requiredApprovals: 1,
      isApproved: true,
      isRejected: false,
      reviewers: [],
      assignee: null,
      body: "Update hand hygiene",
      approvalState: "published",
      user: { login: "bob" },
      reviews: [],
    },
    branchLabel: null,
    documents: [],
    removedDocuments: [],
    isBehind: false,
    hasConflicts: false,
    blockOnUnresolvedThreads: false,
    unresolvedThreadCount: 0,
    canManage: true,
    requiredReviewers: { users: [], teams: [] },
    viewer: { canApprove: false, canPublish: false },
    outcome: "published",
    closedAt: "2026-09-02T15:30:00Z",
    decidedBy: "priya",
    clearsApprovalsOnEdit: true,
    ...overrides,
  } as WorkspaceChangeDetailPayload;
}

test("a published binder change ends its history on who published it, and when", () => {
  const record = binderChangeDetailToRecord(changeDetail());

  expect(record.open).toBe(false);
  expect(record.outcome).toBe("published");
  expect(record.decidedBy).toBe("priya");
  expect(record.closedAt).toBe("2026-09-02T15:30:00Z");

  const entries = buildReviewTimeline({
    change: record,
    threads: [],
    updates: [],
    resetsApprovals: false,
  });
  const last = entries[entries.length - 1];
  expect(last?.kind).toBe("closed");
  expect(last?.event?.actor).toBe("Priya");
  expect(last?.event?.verb).toBe("published this");
  expect(last?.event?.when).not.toBe("");
});

test("an open binder change has no ending yet", () => {
  const detail = changeDetail({
    outcome: null,
    closedAt: null,
    decidedBy: null,
  });
  detail.change.state = "open";
  const record = binderChangeDetailToRecord(detail);

  expect(record.open).toBe(true);
  expect(record.outcome).toBeNull();

  const entries = buildReviewTimeline({
    change: record,
    threads: [],
    updates: [],
    resetsApprovals: false,
  });
  expect(entries.some((entry) => entry.kind === "closed")).toBe(false);
});
