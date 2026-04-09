import type { components } from "./spec/gitea";

import { toGiteaApiError, unwrap, type GiteaClient } from "./client";

type PullRequest = components["schemas"]["PullRequest"];
type PullReview = components["schemas"]["PullReview"];

export type ApprovalState =
  | "working"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "published";

export interface PullRequestWithApprovalState extends PullRequest {
  approvalState: ApprovalState;
}

export interface CreatePullRequestParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface GetPullRequestForBranchParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  branch: string;
}

export interface SubmitReviewParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  pullNumber: number;
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body?: string;
}

export interface MergePullRequestParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  pullNumber: number;
  mergeStyle: "merge" | "squash" | "rebase";
  message?: string;
}

export interface ListPullRequestsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  state: "open" | "closed" | "all";
  page?: number;
}

function toApprovalStateFromReview(review: PullReview): ApprovalState | null {
  const state = review.state?.toUpperCase();

  if (state === "REQUEST_CHANGES" || state === "CHANGES_REQUESTED") {
    return "changes_requested";
  }

  if (state === "APPROVED" || state === "APPROVE") {
    return "approved";
  }

  return null;
}

function isMergedPullRequest(pullRequest: PullRequest): boolean {
  const candidate = pullRequest as {
    merged?: unknown;
    merged_at?: unknown;
  };

  return (
    candidate.merged === true ||
    (typeof candidate.merged_at === "string" &&
      candidate.merged_at.trim() !== "")
  );
}

function resolveApprovalState(
  pullRequest: PullRequest,
  reviews: PullReview[],
): ApprovalState {
  if (isMergedPullRequest(pullRequest)) {
    return "published";
  }

  const reviewStates = reviews.map(toApprovalStateFromReview);
  if (reviewStates.includes("changes_requested")) {
    return "changes_requested";
  }

  if (reviewStates.includes("approved")) {
    return "approved";
  }

  return pullRequest.state === "open" ? "in_review" : "working";
}

function withApprovalState(
  pullRequest: PullRequest,
  reviews: PullReview[],
): PullRequestWithApprovalState {
  return {
    ...pullRequest,
    approvalState: resolveApprovalState(pullRequest, reviews),
  };
}

function pullRequestSelectionRank(pullRequest: PullRequest): number {
  const openBonus = pullRequest.state === "open" ? 1_000_000 : 0;
  const numberRank = pullRequest.number ?? 0;
  return openBonus + numberRank;
}

function selectPullRequestForBranch(
  pullRequests: PullRequest[],
  branch: string,
): PullRequest | null {
  const candidates = pullRequests.filter(
    (candidate) => candidate.head?.ref === branch,
  );
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort(
    (left, right) =>
      pullRequestSelectionRank(right) - pullRequestSelectionRank(left),
  );
  return candidates[0] ?? null;
}

async function listPullReviews(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullReview[]> {
  const allReviews: PullReview[] = [];
  const limit = 100;

  for (let page = 1; page < 100; page += 1) {
    const reviews = await unwrap(
      client.GET("/repos/{owner}/{repo}/pulls/{index}/reviews", {
        params: {
          path: { owner, repo, index: pullNumber },
          query: { limit, page },
        },
      }),
    );

    allReviews.push(...reviews);

    if (reviews.length < limit) {
      break;
    }
  }

  return allReviews;
}

export async function createPullRequest(
  params: CreatePullRequestParams,
): Promise<PullRequestWithApprovalState> {
  const { client, owner, repo, title, head, base, body } = params;

  const pullRequest = await unwrap(
    client.POST("/repos/{owner}/{repo}/pulls", {
      params: { path: { owner, repo } },
      body: { title, head, base, body: body ?? "" },
    }),
  );

  const reviews = pullRequest.number
    ? await listPullReviews(client, owner, repo, pullRequest.number)
    : [];

  return withApprovalState(pullRequest, reviews);
}

export async function getPullRequestForBranch(
  params: GetPullRequestForBranchParams,
): Promise<PullRequestWithApprovalState | null> {
  const { client, owner, repo, branch } = params;

  const pullRequests = await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls", {
      params: {
        path: { owner, repo },
        query: { state: "all", head: `${owner}:${branch}` },
      },
    }),
  );

  const pullRequest = selectPullRequestForBranch(pullRequests, branch);

  if (!pullRequest || !pullRequest.number) {
    return null;
  }

  const reviews = await listPullReviews(
    client,
    owner,
    repo,
    pullRequest.number,
  );
  return withApprovalState(pullRequest, reviews);
}

export async function submitReview(
  params: SubmitReviewParams,
): Promise<PullReview> {
  const { client, owner, repo, pullNumber, event, body } = params;

  // Step 1: Create a pending review.
  // In Gitea 1.21+, POST /pulls/{index}/reviews always creates a PENDING
  // review; the event field is silently ignored by the create endpoint. A
  // non-empty body must be supplied or Gitea rejects the request entirely.
  const pendingReview = await unwrap(
    client.POST("/repos/{owner}/{repo}/pulls/{index}/reviews", {
      params: { path: { owner, repo, index: pullNumber } },
      body: { body: body ?? "" },
    }),
  );

  const reviewId = pendingReview.id;
  if (!reviewId) {
    throw toGiteaApiError(0, "Review was created without an id.");
  }

  // Step 2: Submit the pending review via Gitea's SubmitPullReview endpoint.
  //
  // Gitea's Go constants define the accepted event values as:
  //   "APPROVED"         → ReviewStateApproved  (approve the PR)
  //   "REQUEST_CHANGES"  → ReviewStateRequestChanges
  //   "COMMENT"          → ReviewStateComment
  //
  // Sending "APPROVE" (without the trailing D) hits the default switch branch,
  // leaves the type as ReviewTypePending, and Gitea returns "review stay pending".
  // Normalise "APPROVE" → "APPROVED" so callers using either spelling succeed.
  const submitEvent = event === "APPROVE" ? "APPROVED" : event;
  return unwrap(
    client.POST("/repos/{owner}/{repo}/pulls/{index}/reviews/{id}", {
      params: { path: { owner, repo, index: pullNumber, id: reviewId } },
      body: {
        event: submitEvent,
        ...(body ? { body } : {}),
      },
    }),
  );
}

export async function mergePullRequest(
  params: MergePullRequestParams,
): Promise<void> {
  const { client, owner, repo, pullNumber, mergeStyle, message } = params;

  // Gitea computes PR mergeability asynchronously. If a recent state change
  // (e.g. an approval) triggered a re-check, the merge endpoint returns
  // "Please try again later" (405) until the check completes. Poll until the
  // merge succeeds or a non-transient error is returned.
  const MAX_ATTEMPTS = 15;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { response, error } = await client.POST(
      "/repos/{owner}/{repo}/pulls/{index}/merge",
      {
        params: { path: { owner, repo, index: pullNumber } },
        body: {
          Do: mergeStyle,
          ...(message ? { MergeMessageField: message } : {}),
        },
      },
    );

    // Gitea returns 200 on a successful merge (not 204 as one might expect).
    if (response.status >= 200 && response.status < 300) {
      return;
    }

    // Gitea returns 405 while its internal mergeability check is still running.
    // Known transient messages:
    //   - "Please try again later" — merge-check in progress
    //   - "Does not have enough approvals" — approval not yet indexed by merge check
    // Both resolve on their own once Gitea catches up. Wait and retry.
    const apiError = toGiteaApiError(response.status, error);
    const msg = apiError.message.toLowerCase();
    const isTransient405 =
      response.status === 405 &&
      (msg.includes("please try again later") ||
        msg.includes("not have enough approvals"));
    if (isTransient405 && attempt < MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }

    throw apiError;
  }
}

export async function listPullRequests(
  params: ListPullRequestsParams,
): Promise<PullRequestWithApprovalState[]> {
  const { client, owner, repo, state, page } = params;

  const pullRequests = await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls", {
      params: {
        path: { owner, repo },
        query: { state, page },
      },
    }),
  );

  const mapped = await Promise.all(
    pullRequests.map(async (pullRequest) => {
      const reviews = pullRequest.number
        ? await listPullReviews(client, owner, repo, pullRequest.number)
        : [];
      return withApprovalState(pullRequest, reviews);
    }),
  );

  return mapped;
}
