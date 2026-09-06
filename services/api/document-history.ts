/**
 * Version history assembly.
 *
 * A published version is a tag on `main`. The review that approved it lives on
 * the pull request whose merge commit that tag points at. Gitea keeps those two
 * facts in separate places, so this module joins them back together: for every
 * version, who submitted it, who signed off, and what they said.
 *
 * Everything here is pure. The Gitea calls happen in the request handler.
 */

import {
  buildChangeReviewers,
  countApprovals,
  readAssignee,
  readRequestedReviewers,
} from "./change-assignments";
import type { DocTag } from "./gitea-client/repos";
import type { PullRequestWithReviews } from "./gitea-client/pullRequests";
import type { components } from "./gitea-client/spec/gitea";
import type {
  ClosedChange,
  DocumentVersionRecord,
  VersionReview,
  VersionSubmission,
} from "../../packages/api-schema/schemas/documents";

type PullReview = components["schemas"]["PullReview"];
type PullRequest = components["schemas"]["PullRequest"];

/**
 * Reviews Gitea reports that carry no signal for the record: a review the
 * author never submitted, or a bare "please review this" request.
 */
const HIDDEN_REVIEW_STATES = new Set(["PENDING", "REQUEST_REVIEW"]);

function normalizeReviewState(
  state: string | undefined,
): VersionReview["state"] {
  switch ((state ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REQUEST_CHANGES":
      return "changes_requested";
    case "COMMENT":
      return "commented";
    default:
      return "other";
  }
}

export function toVersionReview(review: PullReview): VersionReview {
  const user = review.user;
  return {
    id: review.id ?? 0,
    author: {
      login: user?.login ?? "unknown",
      fullName: user?.full_name ?? "",
      avatarUrl: user?.avatar_url ?? "",
    },
    state: normalizeReviewState(review.state),
    body: review.body ?? "",
    submittedAt: review.submitted_at ?? review.updated_at ?? "",
    stale: review.stale === true,
    dismissed: review.dismissed === true,
  };
}

/**
 * The reviews worth showing on a version, oldest first so the panel reads as
 * the conversation actually happened.
 */
export function toVersionReviews(reviews: PullReview[]): VersionReview[] {
  return reviews
    .filter(
      (review) => !HIDDEN_REVIEW_STATES.has((review.state ?? "").toUpperCase()),
    )
    .map(toVersionReview)
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
}

/**
 * Who submitted a version and who published it.
 *
 * `publishedBy` exists because Gitea's *list* of pull requests omits
 * `merged_by` — it is only filled in on a single pull request's own endpoint.
 * The history spline names the publisher, so the caller reads it per change
 * and passes it in; without it, every version would claim nobody published it.
 */
export function toVersionSubmission(
  pullRequest: PullRequest,
  publishedBy: string | null = null,
): VersionSubmission {
  return {
    number: pullRequest.number ?? 0,
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? "",
    submittedBy: pullRequest.user?.login ?? "",
    submittedAt: pullRequest.created_at ?? "",
    mergedAt: pullRequest.merged_at ?? null,
    mergedBy: pullRequest.merged_by?.login ?? publishedBy,
  };
}

/**
 * Join tags to the pull requests that produced them.
 *
 * `createDocTag` tags `main` immediately after the merge, so a version's tag
 * SHA is the pull request's merge commit. Versions with no matching pull
 * request — imported repos, tags created by hand in Gitea — still appear; the
 * history is the record, and dropping a version because its paperwork is
 * missing would be the opposite of an audit trail.
 */
export function buildVersionRecords(
  tags: DocTag[],
  pullRequests: PullRequestWithReviews[],
  discussionCounts: Map<number, number> = new Map(),
  publishers: Map<number, string> = new Map(),
): DocumentVersionRecord[] {
  const byMergeSha = new Map<string, PullRequestWithReviews>();
  for (const entry of pullRequests) {
    const sha = (entry.pullRequest as { merge_commit_sha?: string })
      .merge_commit_sha;
    if (sha) {
      byMergeSha.set(sha, entry);
    }
  }

  return [...tags]
    .sort((left, right) => right.version - left.version)
    .map((tag) => {
      const match = byMergeSha.get(tag.sha) ?? null;
      const prNumber = match?.pullRequest.number ?? null;

      return {
        version: tag.version,
        tagName: tag.name,
        sha: tag.sha,
        createdAt: tag.created,
        submission: match
          ? toVersionSubmission(
              match.pullRequest,
              prNumber === null ? null : (publishers.get(prNumber) ?? null),
            )
          : null,
        reviews: match ? toVersionReviews(match.reviews) : [],
        discussionCount:
          prNumber === null ? 0 : (discussionCounts.get(prNumber) ?? 0),
      };
    });
}

/**
 * How a closed change ended, in the terms a reviewer would use.
 *
 * Gitea only records "closed", which is the one word that tells a reader
 * nothing: an approved version that shipped and a draft its own author gave up
 * on look identical in the API. A change that was merged became a version; a
 * change that was closed after somebody asked for work that never arrived was
 * declined; anything else was withdrawn.
 */
export interface ClosedChangeOutcome {
  outcome: ClosedChange["outcome"];
  /** Who published it, or who asked for work it never came back from. */
  decidedBy: string | null;
}

/**
 * How one closed change ended, from the change and its reviews.
 *
 * Pulled out of `buildClosedChanges` so a binder's change list can reach the
 * same answer without a second copy of the rule — the wording a reader sees
 * for "declined" and "withdrawn" is decided once.
 */
export function resolveClosedOutcome(
  pullRequest: PullRequestWithReviews["pullRequest"],
  reviews: PullReview[],
): ClosedChangeOutcome {
  const published = pullRequest.approvalState === "published";

  // The last person to ask for work is the one who blocked it; a stale or
  // dismissed review no longer speaks for the change's fate.
  const blockingReview = [...reviews]
    .filter(
      (review) =>
        normalizeReviewState(review.state) === "changes_requested" &&
        review.dismissed !== true,
    )
    .sort((left, right) =>
      (left.submitted_at ?? "").localeCompare(right.submitted_at ?? ""),
    )
    .pop();

  return {
    outcome: published
      ? "published"
      : blockingReview
        ? "declined"
        : "withdrawn",
    decidedBy: published
      ? ((pullRequest as { merged_by?: { login?: string } }).merged_by?.login ??
        null)
      : (blockingReview?.user?.login ?? null),
  };
}

export function buildClosedChanges(
  entries: PullRequestWithReviews[],
  tags: DocTag[],
  /** null when the approval policy could not be read. See ClosedChange. */
  requiredApprovals: number | null = null,
): ClosedChange[] {
  const versionByMergeSha = new Map<string, number>();
  for (const tag of tags) {
    versionByMergeSha.set(tag.sha, tag.version);
  }

  return entries
    .map(({ pullRequest, reviews }) => {
      const mergeSha = (pullRequest as { merge_commit_sha?: string })
        .merge_commit_sha;
      const published = pullRequest.approvalState === "published";
      const { outcome, decidedBy } = resolveClosedOutcome(pullRequest, reviews);

      const submittedBy = pullRequest.user?.login ?? "";

      return {
        number: pullRequest.number ?? 0,
        title: pullRequest.title ?? "",
        body: pullRequest.body ?? "",
        reviews: toVersionReviews(reviews),
        reviewers: buildChangeReviewers({
          requested: readRequestedReviewers(pullRequest),
          reviews,
          submittedBy,
        }),
        assignee: readAssignee(pullRequest),
        approvalCount: countApprovals(reviews),
        requiredApprovals,
        branchName: pullRequest.head?.ref ?? "",
        submittedBy,
        submittedAt: pullRequest.created_at ?? "",
        closedAt: pullRequest.merged_at ?? pullRequest.closed_at ?? null,
        outcome,
        decidedBy,
        publishedVersion:
          published && mergeSha
            ? (versionByMergeSha.get(mergeSha) ?? null)
            : null,
      };
    })
    .sort((left, right) => right.number - left.number);
}
