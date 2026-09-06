import { expect, test } from "bun:test";

import {
  buildDocumentCrumbs,
  buildDocumentUrl,
  describeVersionState,
  downloadFileName,
  parseRequestedVersion,
  resolveDocumentRef,
} from "./binderDocument";

const documentInFolder = {
  path: "nursing/hand-hygiene.pdf",
  slugPath: "nursing/hand-hygiene",
  name: "hand-hygiene",
  folder: "nursing",
  size: 1024,
  sha: "abc123",
};

const rootDocument = {
  path: "handover.md",
  slugPath: "handover",
  name: "handover",
  folder: "",
  size: 512,
  sha: "def456",
};

const versions = [
  { tag: "nursing/hand-hygiene/v3", version: 3, commitSha: "ccc" },
  { tag: "nursing/hand-hygiene/v2", version: 2, commitSha: "bbb" },
  { tag: "nursing/hand-hygiene/v1", version: 1, commitSha: "aaa" },
];

// ── buildDocumentCrumbs ────────────────────────────────────────────

test("the trail is the folders and the document, not the binder above it", () => {
  // The binder's own header names the organization and the binder already.
  expect(buildDocumentCrumbs(documentInFolder)).toEqual([
    { label: "nursing", isDocument: false },
    { label: "Hand Hygiene", isDocument: true },
  ]);
});

test("a document at the binder's root is its own whole trail", () => {
  expect(buildDocumentCrumbs(rootDocument)).toEqual([
    { label: "Handover", isDocument: true },
  ]);
});

test("nested folders each get their own step", () => {
  expect(
    buildDocumentCrumbs({
      folder: "clinical/nursing/infection",
      name: "policy",
    }).map((crumb) => crumb.label),
  ).toEqual(["clinical", "nursing", "infection", "Policy"]);
});

// ── resolveDocumentRef ─────────────────────────────────────────────

test("no version asked for reads the record, not the newest tag", () => {
  expect(resolveDocumentRef({ versions, requestedVersion: null })).toEqual({
    ref: "main",
    version: versions[0]!,
    missing: false,
  });
});

test("asking for the newest version still reads the record", () => {
  // The tag and `main` are the same commit, and `main` stays right if somebody
  // publishes while the page is open.
  expect(resolveDocumentRef({ versions, requestedVersion: 3 })).toEqual({
    ref: "main",
    version: versions[0]!,
    missing: false,
  });
});

test("an older version is read at its own tag", () => {
  expect(resolveDocumentRef({ versions, requestedVersion: 1 })).toEqual({
    ref: "nursing/hand-hygiene/v1",
    version: versions[2]!,
    missing: false,
  });
});

test("a version that was never published is reported missing", () => {
  expect(resolveDocumentRef({ versions, requestedVersion: 9 })).toEqual({
    ref: "main",
    version: versions[0]!,
    missing: true,
  });
});

test("a document with no versions is not a missing version", () => {
  expect(resolveDocumentRef({ versions: [], requestedVersion: null })).toEqual({
    ref: "main",
    version: null,
    missing: false,
  });
});

// ── describeVersionState / downloadFileName ────────────────────────

test("the version state names the version on record", () => {
  expect(describeVersionState(versions[0]!)).toBe("Version 3 on record");
});

test("an unpublished document says so rather than showing nothing", () => {
  expect(describeVersionState(null)).toBe("No published version yet");
});

test("a download lands under the file's own name, not its path", () => {
  expect(downloadFileName(documentInFolder)).toBe("hand-hygiene.pdf");
  expect(downloadFileName(rootDocument)).toBe("handover.md");
});

// ── the version in the address bar ─────────────────────────────────

test("no version in the query means the version on record", () => {
  expect(parseRequestedVersion("")).toBeNull();
  expect(parseRequestedVersion("?people=alice")).toBeNull();
});

test("a version in the query is read as a number", () => {
  expect(parseRequestedVersion("?version=2")).toBe(2);
});

test("a version that is not a positive whole number is ignored", () => {
  for (const search of [
    "?version=0",
    "?version=-1",
    "?version=x",
    "?version=1.5",
  ]) {
    expect(parseRequestedVersion(search)).toBeNull();
  }
});

test("the record's URL carries no version", () => {
  expect(
    buildDocumentUrl({
      org: "riverside-health",
      binder: "clinical-policies",
      documentPath: "nursing/hand-hygiene",
      version: null,
    }),
  ).toBe("/riverside-health/clinical-policies/nursing/hand-hygiene");
});

test("an earlier version's URL names it, so it can be linked to", () => {
  expect(
    buildDocumentUrl({
      org: "riverside-health",
      binder: "clinical-policies",
      documentPath: "nursing/hand-hygiene",
      version: 2,
    }),
  ).toBe("/riverside-health/clinical-policies/nursing/hand-hygiene?version=2");
});

// ── a document that only exists inside a change ────────────────────

test("with nothing published the file is read from the change's branch", () => {
  // `main` has nothing to give a proposed document, so the page would render
  // "not found" over a file that is right there in the change.
  expect(
    resolveDocumentRef({
      versions: [],
      requestedVersion: null,
      recordRef: "upload/nursing/hand-hygiene/20260905/120000Z-alice-abc12345",
    }),
  ).toEqual({
    ref: "upload/nursing/hand-hygiene/20260905/120000Z-alice-abc12345",
    version: null,
    missing: false,
  });
});

test("a proposed document is in review, not missing a version", () => {
  expect(describeVersionState(null, "proposed")).toBe("In review");
  expect(describeVersionState(null, "published")).toBe(
    "No published version yet",
  );
});

test("a published version still wins over the proposed wording", () => {
  expect(
    describeVersionState(
      { tag: "nursing/hand-hygiene/v2", version: 2, commitSha: "b" },
      "proposed",
    ),
  ).toBe("Version 2 on record");
});
