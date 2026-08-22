/**
 * Who a change is waiting on.
 *
 * "Awaiting review" is a status that names nobody. It tells a compliance
 * manager that something is pending without telling them whose desk it is on,
 * which is exactly the question they opened the page to answer. This module
 * turns Gitea's two separate facts — who was asked to review, and who actually
 * reviewed — into one list of people with a state each, plus the approval
 * count that gates publishing.
 *
 * Everything here is pure. The Gitea calls happen in the request handler.
 */

import type { components } from "./gitea-client/spec/gitea";
import type {
  ChangeReviewer,
  ChangeUser,
  ReviewerStatus,
} from "../../packages/api-schema/schemas/documents";

type PullReview = components["schemas"]["PullReview"];
type PullRequest = components["schemas"]["PullRequest"];
type User = components["schemas"]["User"];

/**
 * Review states that say nothing about where a person stands: a review its
 * author never submitted, and Gitea's own "you have been asked to review"
 * placeholder, which is a request rather than an answer.
 */
const NON_ANSWER_STATES = new Set(["PENDING", "REQUEST_REVIEW", ""]);

export function toChangeUser(user: User | null | undefined): ChangeUser | null {
  const login = user?.login?.trim();
  if (!login) return null;

  return {
    login,
    fullName: user?.full_name ?? "",
    avatarUrl: user?.avatar_url ?? "",
  };
}

function toReviewerStatus(state: string | undefined): ReviewerStatus | null {
  switch ((state ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REQUEST_CHANGES":
      return "changes_requested";
    case "COMMENT":
      return "commented";
    default:
      return null;
  }
}

function reviewTime(review: PullReview): string {
  return review.submitted_at ?? review.updated_at ?? "";
}

/**
 * The one review that speaks for a person right now.
 *
 * A reviewer can approve, be asked for more work by a new upload, and approve
 * again. Only their latest answer describes where the change stands — the
 * earlier ones stay in the discussion log, which is where history belongs.
 */
export function latestReviewByUser(
  reviews: PullReview[],
): Map<string, PullReview> {
  const latest = new Map<string, PullReview>();

  for (const review of reviews) {
    const login = review.user?.login?.trim();
    if (!login) continue;
    if (review.dismissed === true) continue;
    if (NON_ANSWER_STATES.has((review.state ?? "").toUpperCase())) continue;

    const held = latest.get(login);
    if (!held || reviewTime(held).localeCompare(reviewTime(review)) <= 0) {
      latest.set(login, review);
    }
  }

  return latest;
}

/**
 * Approvals that still count.
 *
 * A dismissed approval was taken back and a stale one was overtaken by a new
 * upload; neither is a signature on the version being published. This mirrors
 * what Gitea itself will allow at merge time, so the number on the page and
 * the number the server enforces are the same number.
 */
export function countApprovals(reviews: PullReview[]): number {
  let approvals = 0;

  for (const review of latestReviewByUser(reviews).values()) {
    if (
      toReviewerStatus(review.state) === "approved" &&
      review.stale !== true
    ) {
      approvals += 1;
    }
  }

  return approvals;
}

/**
 * Everyone on the hook for a change, and where each of them stands.
 *
 * Two groups end up in one list: people who were asked and have not answered,
 * and people who answered — whether they were asked or not. Someone who
 * reviews uninvited is still part of the record, so they are shown; they are
 * just marked as not having been requested.
 *
 * The submitter is left out. They cannot review their own change, so listing
 * them as awaiting review would be a queue entry nobody can ever clear.
 */
export function buildChangeReviewers(params: {
  requested: (User | null | undefined)[];
  reviews: PullReview[];
  submittedBy: string;
}): ChangeReviewer[] {
  const { requested, reviews, submittedBy } = params;
  const latest = latestReviewByUser(reviews);
  const byLogin = new Map<string, ChangeReviewer>();

  const add = (user: ChangeUser | null, wasRequested: boolean) => {
    if (!user || user.login === submittedBy) return;

    const review = latest.get(user.login);
    const status = review ? toReviewerStatus(review.state) : null;

    const existing = byLogin.get(user.login);
    byLogin.set(user.login, {
      ...user,
      status: status ?? "awaiting",
      reviewedAt: status && review ? reviewTime(review) : "",
      stale: status ? review?.stale === true : false,
      requested: wasRequested || existing?.requested === true,
    });
  };

  for (const user of requested) {
    add(toChangeUser(user), true);
  }

  for (const review of reviews) {
    add(toChangeUser(review.user), false);
  }

  // Requested-but-silent first: the change is waiting on them, and a list
  // that buries the people it is blocked on is a list nobody acts on.
  const rank: Record<ReviewerStatus, number> = {
    awaiting: 0,
    changes_requested: 1,
    commented: 2,
    approved: 3,
  };

  return [...byLogin.values()].sort(
    (left, right) =>
      rank[left.status] - rank[right.status] ||
      left.login.localeCompare(right.login),
  );
}

/**
 * The difference between the reviewer list the caller wants and the one Gitea
 * holds.
 *
 * The browser sends the whole list rather than "add Dana", so two people
 * editing the same change at once cannot double-add anybody or resurrect a
 * reviewer the other just removed — whoever saves last describes the end
 * state, and only the actual difference is written.
 *
 * The submitter is dropped from the wanted list: Gitea rejects a request for
 * the author's own review with a 422 that would take the rest of the edit down
 * with it.
 */
export function planReviewerChanges(params: {
  current: string[];
  wanted: string[];
  submittedBy: string;
}): { add: string[]; remove: string[] } {
  const { current, submittedBy } = params;
  const wanted = params.wanted.filter((login) => login !== submittedBy);

  return {
    add: wanted.filter((login) => !current.includes(login)),
    remove: current.filter((login) => !wanted.includes(login)),
  };
}

/** The people Gitea currently has down as asked to review. */
export function readRequestedReviewers(pullRequest: PullRequest): User[] {
  const candidate = pullRequest as { requested_reviewers?: unknown };
  return Array.isArray(candidate.requested_reviewers)
    ? (candidate.requested_reviewers as User[])
    : [];
}

/**
 * The assignee, from whichever field Gitea filled in.
 *
 * Gitea reports the primary assignee twice — once on its own and once as the
 * head of the list — and older records only carry the list.
 */
export function readAssignee(pullRequest: PullRequest): ChangeUser | null {
  const candidate = pullRequest as {
    assignee?: User | null;
    assignees?: User[] | null;
  };

  return (
    toChangeUser(candidate.assignee) ??
    toChangeUser(candidate.assignees?.[0]) ??
    null
  );
}
