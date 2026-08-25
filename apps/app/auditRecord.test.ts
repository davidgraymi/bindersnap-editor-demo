import { expect, test } from "bun:test";

import type { DocumentVersionRecord, VersionReview } from "./api";
import { buildAuditRecord, buildAuditRecordFileName } from "./auditRecord";

/**
 * The exported record.
 *
 * What has to hold: every published version appears, every review appears —
 * including the ones that no longer count, labelled as such — and nothing a
 * person typed can escape into the markup of a file that gets emailed around.
 */

function review(overrides: Partial<VersionReview> = {}): VersionReview {
  return {
    id: 1,
    author: { login: "kit", fullName: "Kit Alvarez", avatarUrl: "" },
    state: "approved",
    body: "Reads correctly against the March policy.",
    submittedAt: "2026-08-20T10:00:00Z",
    stale: false,
    dismissed: false,
    ...overrides,
  };
}

function version(
  overrides: Partial<DocumentVersionRecord> = {},
): DocumentVersionRecord {
  return {
    version: 3,
    tagName: "v3",
    sha: "abcdef0123456789",
    createdAt: "2026-08-21T09:00:00Z",
    submission: {
      number: 12,
      title: "Updated liability clause",
      body: "Updated liability clause",
      submittedBy: "maya",
      submittedAt: "2026-08-20T08:00:00Z",
      mergedAt: "2026-08-21T09:00:00Z",
      mergedBy: "dana",
    },
    reviews: [review()],
    discussionCount: 3,
    ...overrides,
  };
}

const GENERATED_AT = new Date("2026-08-24T12:00:00Z");

function record(versions: DocumentVersionRecord[]) {
  return buildAuditRecord({
    owner: "alice",
    repo: "quarterly-report",
    versions,
    generatedAt: GENERATED_AT,
  });
}

test("the file is named for the document and the day it was taken", () => {
  expect(
    buildAuditRecordFileName("quarterly-report", new Date(2026, 7, 4)),
  ).toBe("quarterly-report-audit-record-2026-08-04.html");
});

test("the record names the document, the workspace, and the version on record", () => {
  const { html } = record([version(), version({ version: 2, tagName: "v2" })]);

  expect(html).toContain("<title>Quarterly Report — audit record</title>");
  expect(html).toContain("<dd>alice</dd>");
  expect(html).toContain("<dd>v3</dd>");
  expect(html).toContain("<dd>2</dd>");
});

test("nothing in the record is a tag, a commit, or a repository path", () => {
  // The reader is an auditor, not an engineer. A version number is the whole
  // identity; how Bindersnap stores it underneath is not their question, and
  // they have no way to look any of it up.
  const { html } = record([
    version({ tagName: "release-2026-08", sha: "abcdef0123456789" }),
  ]);

  expect(html).not.toContain("release-2026-08");
  expect(html).not.toContain("abcdef0123456789");
  expect(html).not.toContain("alice/quarterly-report");
  expect(html).not.toContain("Commit");
  expect(html).not.toContain("Tag");
});

test("every version is a section, newest first", () => {
  const { html } = record([
    version({ version: 2, tagName: "v2" }),
    version({ version: 3, tagName: "v3" }),
  ]);

  const labels = [...html.matchAll(/record-version-label">(v\d+)</g)].map(
    (match) => match[1],
  );
  expect(labels).toEqual(["v3", "v2"]);
});

test("a review that no longer counts stays on the record, labelled", () => {
  const { html } = record([
    version({
      reviews: [
        review({ stale: true }),
        review({
          id: 2,
          author: { login: "dana", fullName: "", avatarUrl: "" },
          state: "changes_requested",
          dismissed: true,
          body: "",
        }),
      ],
    }),
  ]);

  expect(html).toContain("Kit Alvarez (kit)");
  expect(html).toContain("superseded by a later upload");
  expect(html).toContain("Dana (dana)");
  expect(html).toContain("Requested changes");
  expect(html).toContain("dismissed");
  expect(html).toContain("No comment");
});

test("a version nobody reviewed says so rather than showing an empty table", () => {
  const { html } = record([version({ reviews: [] })]);

  expect(html).toContain("No reviews were recorded on this change.");
});

test("a version with no surviving change record is still on the record", () => {
  const { html } = record([version({ submission: null })]);

  expect(html).toContain("Version 3");
  expect(html).toContain("No change record survives for this version");
});

test("a document with nothing published exports an honest empty record", () => {
  const { html } = record([]);

  expect(html).toContain("None published");
  expect(html).toContain("no published versions yet");
});

test("what a person typed cannot become markup", () => {
  const { html } = record([
    version({
      submission: {
        number: 12,
        title: "x",
        body: "<script>alert(1)</script>",
        submittedBy: "maya",
        submittedAt: "2026-08-20T08:00:00Z",
        mergedAt: "2026-08-21T09:00:00Z",
        mergedBy: "dana",
      },
      reviews: [review({ body: "<img src=x onerror=alert(1)>" })],
    }),
  ]);

  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
});
