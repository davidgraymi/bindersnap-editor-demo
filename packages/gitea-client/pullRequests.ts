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

/**
 * Attempt to merge a PR and return the outcome.
 * Returns `"ok"` on success, `"conflict"` on 405/409 non-transient errors
 * (merge conflicts, unmergeable PRs), or throws on any other error.
 *
 * Gitea uses 405 for both transient states ("please try again later") and
 * permanent merge failures (conflicts, unmergeable). Transient 405s are
 * retried up to `maxAttempts`; non-transient 405s are treated as conflicts.
 */
async function attemptMerge(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
  mergeStyle: "merge" | "squash" | "rebase",
  message?: string,
  maxAttempts = 5,
): Promise<"ok" | "conflict"> {
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

    if (response.status >= 200 && response.status < 300) {
      return "ok";
    }

    if (response.status === 409) {
      return "conflict";
    }

    // Gitea returns 405 for multiple reasons. Only these two are transient
    // (Gitea's async mergeability check hasn't finished yet):
    //   - "Please try again later"
    //   - "Does not have enough approvals" (approval not yet indexed)
    // Any other 405 means the PR genuinely cannot be merged (e.g. conflicts).
    if (response.status === 405) {
      const apiError = toGiteaApiError(response.status, error);
      const msg = apiError.message.toLowerCase();
      const isTransient =
        msg.includes("please try again later") ||
        msg.includes("not have enough approvals");

      if (isTransient && attempt < maxAttempts) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS),
        );
        continue;
      }

      // Non-transient 405 or exhausted retries — treat as conflict.
      return "conflict";
    }

    // Any other status code is a real error (403, 422, 423, etc.)
    throw toGiteaApiError(response.status, error);
  }

  // Should not be reachable, but guard against it.
  return "conflict";
}

/**
 * Resolve merge conflicts on a PR's head branch by synchronising it with
 * the current base branch (main), then re-applying the uploaded file.
 *
 * Strategy (avoids deleting the branch, which permanently breaks the PR
 * in Gitea's merge index):
 *   1. Read the document file content from the head branch (save for later).
 *   2. Overwrite the file on the head branch with main's version so the
 *      two branches have identical file content — this eliminates the
 *      merge conflict.
 *   3. Use the PR update endpoint to merge main into the head branch.
 *   4. Re-commit the original uploaded content on top of the now-synced
 *      branch, making the PR diff show the intended change.
 *
 * This is designed for single-file document repos where the uploaded file
 * should always completely overwrite whatever is on the base branch.
 */
async function resolveConflictsByRebase(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<void> {
  // 1. Get the PR to find the head branch name.
  const pr = await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls/{index}", {
      params: { path: { owner, repo, index: pullNumber } },
    }),
  );

  const headBranch = pr.head?.ref;
  if (!headBranch) {
    throw toGiteaApiError(0, "PR has no head branch ref.");
  }

  // 2. List files on the head branch to find the document file.
  const contents = await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: "" },
        query: { ref: headBranch },
      },
    }),
  );

  const entries = Array.isArray(contents) ? contents : [];
  const docEntry = entries.find(
    (entry: { name?: string; type?: string }) =>
      entry.type === "file" &&
      typeof entry.name === "string" &&
      !entry.name.startsWith(".") &&
      entry.name !== "README.md",
  );

  if (!docEntry?.path) {
    throw toGiteaApiError(0, "Could not find document file on head branch.");
  }

  const filePath = docEntry.path as string;

  // 3. Read the uploaded file content from the head branch (we'll re-apply
  //    this after syncing with main).
  const headFile = (await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: filePath },
        query: { ref: headBranch },
      },
    }),
  )) as { content?: string; sha?: string };

  const uploadedContent = headFile.content;
  const headFileSha = headFile.sha;
  if (!uploadedContent || !headFileSha) {
    throw toGiteaApiError(0, "Could not read file content from head branch.");
  }

  // 4. Read the same file from main so we can make the head branch match.
  const mainFile = (await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: filePath },
        query: { ref: "main" },
      },
    }),
  )) as { content?: string };

  if (!mainFile.content) {
    throw toGiteaApiError(0, "Could not read file content from main branch.");
  }

  // 5. Overwrite the file on the head branch with main's content.
  //    This eliminates the merge conflict since both branches now have
  //    identical file content.
  await unwrap(
    client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
      params: { path: { owner, repo, filepath: filePath } },
      body: {
        content: mainFile.content,
        message: "Sync with main for conflict resolution",
        branch: headBranch,
        sha: headFileSha,
      },
    }),
  );

  // 6. Merge main into the head branch via the PR update endpoint.
  //    Now that file contents match, the merge is conflict-free.
  //    This endpoint returns 200 with an empty body on success.
  //    It may also return a non-2xx with "up to date" when the head branch
  //    is already based on the latest main commit — that is fine and means
  //    the sync is already complete; we skip this step and continue.
  const { error: updateError, response: updateResponse } = await client.POST(
    "/repos/{owner}/{repo}/pulls/{index}/update",
    {
      params: { path: { owner, repo, index: pullNumber } },
    },
  );

  if (!updateResponse.ok) {
    const apiError = toGiteaApiError(updateResponse.status, updateError);
    const isAlreadyUpToDate = apiError.message
      .toLowerCase()
      .includes("up to date");
    if (!isAlreadyUpToDate) {
      throw apiError;
    }
    // Head is already up to date with main — no merge needed, continue.
  }

  // 7. Read the file SHA on the now-synced head branch (it changed after
  //    the merge-update commit).
  const syncedFile = (await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: filePath },
        query: { ref: headBranch },
      },
    }),
  )) as { sha?: string };

  if (!syncedFile.sha) {
    throw toGiteaApiError(0, "Could not read synced file SHA after update.");
  }

  // 8. Re-commit the original uploaded content so the PR shows the
  //    intended file change against the current main.
  await unwrap(
    client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
      params: { path: { owner, repo, filepath: filePath } },
      body: {
        content: uploadedContent,
        message: "Restore uploaded content after conflict resolution",
        branch: headBranch,
        sha: syncedFile.sha,
      },
    }),
  );
}

export async function mergePullRequest(
  params: MergePullRequestParams,
): Promise<void> {
  const { client, owner, repo, pullNumber, mergeStyle, message } = params;

  const result = await attemptMerge(
    client,
    owner,
    repo,
    pullNumber,
    mergeStyle,
    message,
  );

  if (result !== "ok") {
    throw toGiteaApiError(
      409,
      "Merge conflict: the pull request cannot be merged.",
    );
  }
}

/**
 * Merge a PR, automatically resolving merge conflicts if present.
 *
 * Checks the PR's mergeable status first to avoid wasted retries:
 * - If mergeable: merges normally (fast path, ~5 retries for transient states).
 * - If not mergeable: resolves conflicts by syncing the head branch with
 *   main, then retries the merge (slower path, up to 15 retries).
 */
export async function mergeOrResolveConflicts(
  params: MergePullRequestParams,
): Promise<void> {
  const { client, owner, repo, pullNumber, mergeStyle, message } = params;

  // Check if the PR has merge conflicts before attempting.
  const pr = await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls/{index}", {
      params: { path: { owner, repo, index: pullNumber } },
    }),
  );

  if (pr.mergeable !== false) {
    // No known conflict — try normal merge.
    const result = await attemptMerge(
      client,
      owner,
      repo,
      pullNumber,
      mergeStyle,
      message,
    );
    if (result === "ok") return;
    // Still failed — fall through to conflict resolution.
  }

  await resolveConflictsByRebase(client, owner, repo, pullNumber);

  // Retry after resolution with more attempts — Gitea needs time to
  // recalculate mergeability after the branch update.
  const POST_RESOLVE_ATTEMPTS = 15;
  const retryResult = await attemptMerge(
    client,
    owner,
    repo,
    pullNumber,
    mergeStyle,
    message,
    POST_RESOLVE_ATTEMPTS,
  );

  if (retryResult !== "ok") {
    throw toGiteaApiError(
      409,
      "Merge conflict persisted after conflict resolution.",
    );
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
