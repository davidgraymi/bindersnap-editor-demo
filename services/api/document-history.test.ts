import { expect, test } from "bun:test";

import {
  buildClosedChanges,
  buildVersionRecords,
  toVersionReviews,
} from "./document-history";
import type { PullRequestWithReviews } from "./gitea-client/pullRequests";
import type { DocTag } from "./gitea-client/repos";

function tag(version: number, sha: string, created: string): DocTag {
  return { name: `v${version}`, version, sha, created };
}

function mergedPR(
  number: number,
  mergeSha: string,
  reviews: PullRequestWithReviews["reviews"] = [],
): PullRequestWithReviews {
  return {
    pullRequest: {
      number,
      title: `Upload v${number}`,
      body: "Automated upload from Bindersnap file vault.",
      state: "closed",
      approvalState: "published",
      created_at: "2026-01-01T00:00:00Z",
      merged_at: "2026-01-02T00:00:00Z",
      merged_by: { login: "carol" },
      merge_commit_sha: mergeSha,
      user: { login: "bob" },
    } as unknown as PullRequestWithReviews["pullRequest"],
    reviews,
  };
}

test("joins each version to the pull request whose merge commit it tags", () => {
  const versions = buildVersionRecords(
    [tag(1, "sha-one", "2026-01-02T00:00:00Z")],
    [mergedPR(7, "sha-one")],
  );

  expect(versions).toHaveLength(1);
  expect(versions[0]?.submission).toEqual({
    number: 7,
    title: "Upload v7",
    body: "Automated upload from Bindersnap file vault.",
    submittedBy: "bob",
    submittedAt: "2026-01-01T00:00:00Z",
    mergedAt: "2026-01-02T00:00:00Z",
    mergedBy: "carol",
  });
});

test("orders versions newest first", () => {
  const versions = buildVersionRecords(
    [
      tag(1, "a", "2026-01-01T00:00:00Z"),
      tag(3, "c", "2026-03-01T00:00:00Z"),
      tag(2, "b", "2026-02-01T00:00:00Z"),
    ],
    [],
  );

  expect(versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
});

test("keeps a version whose pull request cannot be matched", () => {
  const versions = buildVersionRecords(
    [tag(1, "orphan-sha", "2026-01-02T00:00:00Z")],
    [mergedPR(7, "different-sha")],
  );

  expect(versions[0]?.submission).toBeNull();
  expect(versions[0]?.reviews).toEqual([]);
  expect(versions[0]?.discussionCount).toBe(0);
});

test("attaches the discussion count for the matched pull request", () => {
  const versions = buildVersionRecords(
    [tag(1, "sha-one", "2026-01-02T00:00:00Z")],
    [mergedPR(7, "sha-one")],
    new Map([[7, 4]]),
  );

  expect(versions[0]?.discussionCount).toBe(4);
});

test("normalizes review states and orders them oldest first", () => {
  const reviews = toVersionReviews([
    {
      id: 2,
      state: "REQUEST_CHANGES",
      body: "Fix the effective date.",
      submitted_at: "2026-01-01T12:00:00Z",
      user: { login: "dana", full_name: "Dana Reyes", avatar_url: "" },
    },
    {
      id: 1,
      state: "APPROVED",
      body: "",
      submitted_at: "2026-01-01T09:00:00Z",
      stale: true,
      user: { login: "carol", full_name: "", avatar_url: "" },
    },
  ] as never);

  expect(reviews.map((review) => review.id)).toEqual([1, 2]);
  expect(reviews[0]).toMatchObject({
    state: "approved",
    stale: true,
    author: { login: "carol", fullName: "" },
  });
  expect(reviews[1]?.state).toBe("changes_requested");
});

test("hides pending and review-request entries — they say nothing for the record", () => {
  const reviews = toVersionReviews([
    { id: 1, state: "PENDING", user: { login: "dana" } },
    { id: 2, state: "REQUEST_REVIEW", user: { login: "erin" } },
    { id: 3, state: "COMMENT", user: { login: "carol" } },
  ] as never);

  expect(reviews.map((review) => review.id)).toEqual([3]);
  expect(reviews[0]?.state).toBe("commented");
});

function closedPR(
  number: number,
  overrides: Record<string, unknown> = {},
  reviews: PullRequestWithReviews["reviews"] = [],
): PullRequestWithReviews {
  return {
    pullRequest: {
      number,
      title: `Upload #${number}`,
      body: "Automated upload from Bindersnap file vault.",
      state: "closed",
      approvalState: "working",
      branchName: `upload/v${number}`,
      head: { ref: `upload/v${number}` },
      created_at: "2026-01-01T00:00:00Z",
      closed_at: "2026-01-05T00:00:00Z",
      user: { login: "bob" },
      ...overrides,
    } as unknown as PullRequestWithReviews["pullRequest"],
    reviews,
  };
}

test("a merged change reports the version it became and who published it", () => {
  const [change] = buildClosedChanges(
    [mergedPR(7, "sha-one")],
    [tag(3, "sha-one", "2026-01-02T00:00:00Z")],
  );

  expect(change?.outcome).toBe("published");
  expect(change?.publishedVersion).toBe(3);
  expect(change?.decidedBy).toBe("carol");
  expect(change?.closedAt).toBe("2026-01-02T00:00:00Z");
});

test("a change closed after changes were requested was declined, by name", () => {
  const [change] = buildClosedChanges(
    [
      closedPR(9, {}, [
        {
          state: "REQUEST_CHANGES",
          submitted_at: "2026-01-03T00:00:00Z",
          user: { login: "dana" },
        },
      ] as unknown as PullRequestWithReviews["reviews"]),
    ],
    [],
  );

  expect(change?.outcome).toBe("declined");
  expect(change?.decidedBy).toBe("dana");
});

test("a dismissed request for changes no longer decides the outcome", () => {
  const [change] = buildClosedChanges(
    [
      closedPR(9, {}, [
        {
          state: "REQUEST_CHANGES",
          submitted_at: "2026-01-03T00:00:00Z",
          dismissed: true,
          user: { login: "dana" },
        },
      ] as unknown as PullRequestWithReviews["reviews"]),
    ],
    [],
  );

  expect(change?.outcome).toBe("withdrawn");
  expect(change?.decidedBy).toBeNull();
});

test("a change closed with no decision on it was withdrawn", () => {
  const [change] = buildClosedChanges([closedPR(4)], []);

  expect(change?.outcome).toBe("withdrawn");
  expect(change?.publishedVersion).toBeNull();
  expect(change?.branchName).toBe("upload/v4");
});

test("closed changes come back newest first", () => {
  const changes = buildClosedChanges(
    [closedPR(2), closedPR(11), closedPR(7)],
    [],
  );

  expect(changes.map((change) => change.number)).toEqual([11, 7, 2]);
});
