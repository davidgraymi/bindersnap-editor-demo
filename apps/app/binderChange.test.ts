import { expect, test } from "bun:test";

import {
  buildChangeUrl,
  describePublishBlock,
  describePublished,
  describeVersionStep,
  parseRequestedChange,
} from "./binderChange";

const newDocument = {
  path: "nursing/hand-hygiene.md",
  slugPath: "nursing/hand-hygiene",
  name: "hand-hygiene",
  folder: "nursing",
  size: 10,
  sha: "abc",
  nextVersion: 1,
  currentVersion: null,
};

const revision = {
  ...newDocument,
  nextVersion: 3,
  currentVersion: {
    tag: "nursing/hand-hygiene/v2",
    version: 2,
    commitSha: "bbb",
  },
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

test("the binder's URL carries no change", () => {
  expect(
    buildChangeUrl({
      org: "riverside",
      binder: "clinical",
      changeNumber: null,
    }),
  ).toBe("/riverside/clinical");
});

test("a change's URL names it, so it can be sent to a reviewer", () => {
  expect(
    buildChangeUrl({ org: "riverside", binder: "clinical", changeNumber: 3 }),
  ).toBe("/riverside/clinical?change=3");
});

// ── what the change would do ───────────────────────────────────────

test("a revision names both versions, so the step is visible", () => {
  expect(describeVersionStep(revision)).toBe("Hand Hygiene · v2 → v3");
});

test("a document being added says it is new rather than showing v0", () => {
  expect(describeVersionStep(newDocument)).toBe(
    "Hand Hygiene · new, will be v1",
  );
});

// ── why publishing is held ─────────────────────────────────────────

const READY = {
  change: {
    state: "open",
    isApproved: true,
    isRejected: false,
    approvalCount: 1,
    requiredApprovals: 1,
  },
  isBehind: false,
  blockOnUnresolvedThreads: false,
  unresolvedThreadCount: 0,
  documentCount: 1,
};

test("an approved change with nothing open can be published", () => {
  expect(describePublishBlock(READY)).toBeNull();
});

test("a short count says how many more, not just 'not approved'", () => {
  // One approval short and three approvals short look identical if this only
  // says "awaiting review".
  expect(
    describePublishBlock({
      ...READY,
      change: { ...READY.change, isApproved: false, approvalCount: 0 },
    }),
  ).toBe("One more approval is needed before this can be published.");

  expect(
    describePublishBlock({
      ...READY,
      change: {
        ...READY.change,
        isApproved: false,
        approvalCount: 1,
        requiredApprovals: 3,
      },
    }),
  ).toBe("2 more approvals are needed before this can be published.");
});

test("a rejection outranks a satisfied count", () => {
  expect(
    describePublishBlock({
      ...READY,
      change: { ...READY.change, isRejected: true },
    }),
  ).toMatch(/asked for changes/);
});

test("an open thread holds publishing only when the binder says so", () => {
  expect(
    describePublishBlock({ ...READY, unresolvedThreadCount: 2 }),
  ).toBeNull();

  expect(
    describePublishBlock({
      ...READY,
      blockOnUnresolvedThreads: true,
      unresolvedThreadCount: 2,
    }),
  ).toBe(
    "2 discussion threads are still open. Resolve them before publishing.",
  );
});

test("a change touching nothing says so rather than offering publish", () => {
  expect(describePublishBlock({ ...READY, documentCount: 0 })).toBe(
    "This change does not touch any document.",
  );
});

// ── what publishing wrote ──────────────────────────────────────────

test("publishing names every version it wrote", () => {
  // A change that touched three documents publishes three versions, and
  // "Published" alone would hide which.
  expect(
    describePublished([
      { tag: "nursing/hand-hygiene/v3", version: 3 },
      { tag: "handover/v2", version: 2 },
    ]),
  ).toBe("Published v3 of Hand Hygiene, v2 of Handover.");
});

test("being behind outranks the approval count, because updating resets it", () => {
  // A binder refuses to merge a change that is behind however many approvals
  // it has, and bringing it up to date dismisses those approvals — so telling
  // somebody to go collect them first sends them to do wasted work.
  expect(
    describePublishBlock({
      ...READY,
      isBehind: true,
      change: { ...READY.change, isApproved: false, approvalCount: 0 },
    }),
  ).toMatch(/moved on since this change was made/);
});

test("a change that has been decided has nothing standing in its way", () => {
  // Otherwise the page keeps offering the blockers of a change that no longer
  // exists — telling somebody to bring a merged change up to date.
  expect(
    describePublishBlock({
      ...READY,
      isBehind: true,
      change: {
        ...READY.change,
        state: "closed",
        isApproved: false,
        approvalCount: 0,
      },
    }),
  ).toBeNull();
});
