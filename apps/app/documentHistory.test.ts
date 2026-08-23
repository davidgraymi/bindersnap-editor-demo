import { expect, test } from "bun:test";

import type { DocumentVersionRecord, VersionReview } from "./api";
import { buildHistoryEntries, summarizeApprovals } from "./documentHistory";

/**
 * What a knot on the history spline says.
 *
 * The spline is the audit trail, so the wording is the product: which change
 * review produced this version, who wrote it, who published it, and what the
 * reviews came to. Decided here, tested here.
 */

function review(
  login: string,
  state: VersionReview["state"] = "approved",
  fullName = "",
): VersionReview {
  return {
    id: 1,
    author: { login, fullName, avatarUrl: "" },
    state,
    body: "",
    submittedAt: "2026-08-20T10:00:00Z",
    stale: false,
    dismissed: false,
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
    reviews: [review("dana")],
    discussionCount: 3,
    ...overrides,
  };
}

test("a version is titled with the change review that produced it, and links to it", () => {
  const [entry] = buildHistoryEntries([version()], "alice", "contract");

  expect(entry?.title).toBe("Updated liability clause");
  expect(entry?.changeNumber).toBe(12);
  expect(entry?.changeHref).toBe("/docs/alice/contract/changes/12");
});

test("the author and the publisher are both named on the spline", () => {
  const [entry] = buildHistoryEntries([version()], "alice", "contract");

  expect(entry?.author).toEqual({ name: "Maya", login: "maya" });
  expect(entry?.publisher).toEqual({ name: "Dana", login: "dana" });
});

test("a version nobody published names only the author", () => {
  const [entry] = buildHistoryEntries(
    [
      version({
        submission: { ...version().submission!, mergedBy: null },
      }),
    ],
    "alice",
    "contract",
  );

  expect(entry?.author?.name).toBe("Maya");
  expect(entry?.publisher).toBeNull();
});

test("a version whose submission record is gone still gets a knot", () => {
  const [entry] = buildHistoryEntries(
    [version({ submission: null, reviews: [], discussionCount: 0 })],
    "alice",
    "contract",
  );

  expect(entry?.title).toBe("Version 3");
  expect(entry?.changeNumber).toBeNull();
  expect(entry?.changeHref).toBeNull();
  expect(entry?.author).toBeNull();
  expect(entry?.publisher).toBeNull();
});

test("an automated upload is titled by the file it carried", () => {
  const [entry] = buildHistoryEntries(
    [
      version({
        submission: {
          ...version().submission!,
          body: "Automated upload from Bindersnap file vault.\nSource file: vendor-agreement.docx\nUploaded by: maya",
        },
      }),
    ],
    "alice",
    "contract",
  );

  expect(entry?.title).toBe("New version of vendor-agreement.docx");
});

test("the knot carries the version, the date, the commit, and the comment count", () => {
  const [entry] = buildHistoryEntries([version()], "alice", "contract");

  expect(entry?.label).toBe("v3");
  expect(entry?.tagName).toBe("v3");
  expect(entry?.publishedOn).toBe("Aug 21, 2026");
  expect(entry?.shortSha).toBe("abcdef0123");
  expect(entry?.comments).toBe("3 comments");
});

test("one comment is not pluralised, and none is not mentioned", () => {
  const [one] = buildHistoryEntries(
    [version({ discussionCount: 1 })],
    "alice",
    "contract",
  );
  const [none] = buildHistoryEntries(
    [version({ discussionCount: 0 })],
    "alice",
    "contract",
  );

  expect(one?.comments).toBe("1 comment");
  expect(none?.comments).toBeNull();
});

test("approvals name a person rather than counting one", () => {
  expect(summarizeApprovals([])).toBe("No recorded approval");
  expect(summarizeApprovals([review("dana")])).toBe("Approved by Dana");
  expect(summarizeApprovals([review("dana"), review("sam")])).toBe(
    "Approved by Dana and 1 other",
  );
  expect(
    summarizeApprovals([review("dana"), review("sam"), review("kit")]),
  ).toBe("Approved by Dana and 2 others");
});

test("a full name beats a login, and the same person is only counted once", () => {
  expect(summarizeApprovals([review("dana", "approved", "dana reyes")])).toBe(
    "Approved by Dana reyes",
  );
  expect(summarizeApprovals([review("dana"), review("dana")])).toBe(
    "Approved by Dana",
  );
});

test("a comment is not a sign-off", () => {
  expect(
    summarizeApprovals([
      review("sam", "commented"),
      review("kit", "changes_requested"),
    ]),
  ).toBe("No recorded approval");
});

test("every version in the payload becomes a knot, in the order given", () => {
  const entries = buildHistoryEntries(
    [version(), version({ version: 2, tagName: "v2" })],
    "alice",
    "contract",
  );

  expect(entries.map((entry) => entry.label)).toEqual(["v3", "v2"]);
});
