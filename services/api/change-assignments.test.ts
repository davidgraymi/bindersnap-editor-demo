import { expect, test } from "bun:test";

import {
  buildChangeReviewers,
  countApprovals,
  planReviewerChanges,
  readAssignee,
  readRequestedReviewers,
} from "./change-assignments";
import type { components } from "./gitea-client/spec/gitea";

type PullReview = components["schemas"]["PullReview"];
type PullRequest = components["schemas"]["PullRequest"];
type User = components["schemas"]["User"];

function user(login: string, fullName = ""): User {
  return {
    login,
    full_name: fullName,
    avatar_url: `https://gitea.test/avatars/${login}`,
  } as User;
}

function review(
  login: string,
  state: string,
  overrides: Partial<PullReview> = {},
): PullReview {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    user: user(login),
    state,
    body: "",
    submitted_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as PullReview;
}

test("countApprovals counts one approval per person", () => {
  expect(
    countApprovals([
      review("dana", "APPROVED"),
      review("dana", "APPROVED", { submitted_at: "2026-01-02T00:00:00Z" }),
      review("sam", "APPROVED"),
    ]),
  ).toBe(2);
});

test("countApprovals ignores approvals that no longer stand", () => {
  expect(
    countApprovals([
      review("dana", "APPROVED", { dismissed: true }),
      review("sam", "APPROVED", { stale: true }),
      review("kim", "COMMENT"),
      review("lee", "PENDING"),
    ]),
  ).toBe(0);
});

test("countApprovals follows a reviewer's latest word", () => {
  const reviews = [
    review("dana", "APPROVED", { submitted_at: "2026-01-01T00:00:00Z" }),
    review("dana", "REQUEST_CHANGES", {
      submitted_at: "2026-02-01T00:00:00Z",
    }),
  ];

  expect(countApprovals(reviews)).toBe(0);
});

test("buildChangeReviewers reports a requested reviewer who has not answered", () => {
  const reviewers = buildChangeReviewers({
    requested: [user("dana", "Dana Reyes")],
    reviews: [],
    submittedBy: "sam",
  });

  expect(reviewers).toEqual([
    {
      login: "dana",
      fullName: "Dana Reyes",
      avatarUrl: "https://gitea.test/avatars/dana",
      status: "awaiting",
      reviewedAt: "",
      stale: false,
      requested: true,
    },
  ]);
});

test("buildChangeReviewers keeps someone who reviewed without being asked", () => {
  const reviewers = buildChangeReviewers({
    requested: [],
    reviews: [review("kim", "REQUEST_CHANGES")],
    submittedBy: "sam",
  });

  expect(reviewers).toHaveLength(1);
  expect(reviewers[0]?.login).toBe("kim");
  expect(reviewers[0]?.status).toBe("changes_requested");
  expect(reviewers[0]?.requested).toBe(false);
});

test("buildChangeReviewers marks a requested reviewer who has answered", () => {
  const reviewers = buildChangeReviewers({
    requested: [user("dana")],
    reviews: [review("dana", "APPROVED")],
    submittedBy: "sam",
  });

  expect(reviewers).toHaveLength(1);
  expect(reviewers[0]).toMatchObject({
    login: "dana",
    status: "approved",
    requested: true,
    reviewedAt: "2026-01-01T00:00:00Z",
  });
});

test("buildChangeReviewers never lists the submitter as a reviewer", () => {
  const reviewers = buildChangeReviewers({
    requested: [user("sam"), user("dana")],
    reviews: [review("sam", "COMMENT")],
    submittedBy: "sam",
  });

  expect(reviewers.map((reviewer) => reviewer.login)).toEqual(["dana"]);
});

test("buildChangeReviewers puts the people the change waits on first", () => {
  const reviewers = buildChangeReviewers({
    requested: [user("dana"), user("kim"), user("lee")],
    reviews: [review("dana", "APPROVED"), review("kim", "REQUEST_CHANGES")],
    submittedBy: "sam",
  });

  expect(reviewers.map((reviewer) => reviewer.login)).toEqual([
    "lee",
    "kim",
    "dana",
  ]);
});

test("readRequestedReviewers survives a pull request with none", () => {
  expect(readRequestedReviewers({} as PullRequest)).toEqual([]);
  expect(
    readRequestedReviewers({
      requested_reviewers: [user("dana")],
    } as PullRequest).map((reviewer) => reviewer.login),
  ).toEqual(["dana"]);
});

test("readAssignee falls back to the head of the assignee list", () => {
  expect(readAssignee({} as PullRequest)).toBeNull();
  expect(
    readAssignee({ assignees: [user("dana", "Dana Reyes")] } as PullRequest),
  ).toEqual({
    login: "dana",
    fullName: "Dana Reyes",
    avatarUrl: "https://gitea.test/avatars/dana",
  });
  expect(
    readAssignee({
      assignee: user("kim"),
      assignees: [user("dana")],
    } as PullRequest)?.login,
  ).toBe("kim");
});

test("planReviewerChanges writes only the difference", () => {
  expect(
    planReviewerChanges({
      current: ["dana", "kim"],
      wanted: ["dana", "lee"],
      submittedBy: "sam",
    }),
  ).toEqual({ add: ["lee"], remove: ["kim"] });
});

test("planReviewerChanges never asks the submitter to review their own change", () => {
  expect(
    planReviewerChanges({
      current: [],
      wanted: ["sam", "dana"],
      submittedBy: "sam",
    }),
  ).toEqual({ add: ["dana"], remove: [] });
});

test("planReviewerChanges clears the list when asked for an empty one", () => {
  expect(
    planReviewerChanges({
      current: ["dana", "kim"],
      wanted: [],
      submittedBy: "sam",
    }),
  ).toEqual({ add: [], remove: ["dana", "kim"] });
});

test("planReviewerChanges writes nothing when nothing moved", () => {
  expect(
    planReviewerChanges({
      current: ["dana"],
      wanted: ["dana"],
      submittedBy: "sam",
    }),
  ).toEqual({ add: [], remove: [] });
});
