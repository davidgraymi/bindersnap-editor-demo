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
  /** When true, 409 merge conflicts are resolved by rebasing the head branch onto main. */
  resolveConflicts?: boolean;
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
 * Attempt a single merge API call and return the outcome.
 * Returns `"ok"` on success, `"conflict"` on 405/409 non-transient errors
 * (merge conflicts, unmergeable PRs), or throws on any other error.
 *
 * Gitea uses 405 for both transient states ("please try again later") and
 * permanent merge failures (conflicts, unmergeable). Transient 405s are
 * retried internally; non-transient 405s are treated as conflicts.
 */
async function attemptMerge(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
  mergeStyle: "merge" | "squash" | "rebase",
  message?: string,
): Promise<"ok" | "conflict"> {
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

      if (isTransient && attempt < MAX_ATTEMPTS) {
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
 * Resolve merge conflicts on a PR's head branch by rebasing it onto the
 * current base branch. Works by reading the file from the head branch,
 * deleting the branch, recreating it from the base, and re-committing the
 * file. The PR stays open because Gitea tracks PRs by branch name.
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
  //    Document repos have a single file (e.g. document.pdf). We look for
  //    any file that isn't a dotfile or README.
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

  // 3. Read the full file content from the head branch.
  const fileData = await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: filePath },
        query: { ref: headBranch },
      },
    }),
  );

  const fileContent = (fileData as { content?: string }).content;
  if (!fileContent) {
    throw toGiteaApiError(0, "Could not read file content from head branch.");
  }

  // 4. Delete the head branch.
  const { response: deleteResponse } = await client.DELETE(
    "/repos/{owner}/{repo}/branches/{branch}",
    {
      params: { path: { owner, repo, branch: headBranch } },
    },
  );

  if (deleteResponse.status !== 204 && deleteResponse.status !== 200) {
    throw toGiteaApiError(
      deleteResponse.status,
      "Failed to delete head branch for conflict resolution.",
    );
  }

  // 5. Recreate the branch from current main.
  await unwrap(
    client.POST("/repos/{owner}/{repo}/branches", {
      params: { path: { owner, repo } },
      body: {
        new_branch_name: headBranch,
        old_branch_name: "main",
      },
    }),
  );

  // 6. Re-commit the document file to the recreated branch.
  //    The branch was just created from main, so if main has the file we
  //    need its SHA for an update; if not, we create it.
  let existingSha: string | undefined;
  try {
    const existing = await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner, repo, filepath: filePath },
          query: { ref: headBranch },
        },
      }),
    );
    if (existing && !Array.isArray(existing) && existing.sha) {
      existingSha = existing.sha;
    }
  } catch {
    // File doesn't exist on main — will create it
  }

  if (existingSha) {
    await unwrap(
      client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner, repo, filepath: filePath } },
        body: {
          content: fileContent,
          message: `Rebase: update ${filePath} after conflict resolution`,
          branch: headBranch,
          sha: existingSha,
        },
      }),
    );
  } else {
    await unwrap(
      client.POST("/repos/{owner}/{repo}/contents/{filepath}", {
        params: { path: { owner, repo, filepath: filePath } },
        body: {
          content: fileContent,
          message: `Rebase: add ${filePath} after conflict resolution`,
          branch: headBranch,
        },
      }),
    );
  }
}

export async function mergePullRequest(
  params: MergePullRequestParams,
): Promise<void> {
  const {
    client,
    owner,
    repo,
    pullNumber,
    mergeStyle,
    message,
    resolveConflicts: shouldResolveConflicts = false,
  } = params;

  const result = await attemptMerge(
    client,
    owner,
    repo,
    pullNumber,
    mergeStyle,
    message,
  );

  if (result === "ok") {
    return;
  }

  // 409 conflict — resolve if the caller opted in.
  if (!shouldResolveConflicts) {
    throw toGiteaApiError(409, "Merge conflict: the pull request cannot be merged.");
  }

  await resolveConflictsByRebase(client, owner, repo, pullNumber);

  // After resolving, retry the merge. If this still fails, let the error propagate.
  const retryResult = await attemptMerge(
    client,
    owner,
    repo,
    pullNumber,
    mergeStyle,
    message,
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
