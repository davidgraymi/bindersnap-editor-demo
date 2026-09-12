import { expect, test } from "bun:test";

import { describeVersionStep, parseRequestedChange } from "./binderChange";

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

// ── what the change would do ───────────────────────────────────────

test("a revision names both versions, so the step is visible", () => {
  expect(describeVersionStep(revision)).toBe("Hand Hygiene · v2 → v3");
});

test("a document being added says it is new rather than showing v0", () => {
  expect(describeVersionStep(newDocument)).toBe(
    "Hand Hygiene · new, will be v1",
  );
});
