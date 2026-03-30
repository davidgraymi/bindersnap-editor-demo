import type { CreatePullRequestOption, CreatePullReviewOptions, MergePullRequestOption, PullRequest, PullReview } from 'gitea-js';

import { GiteaApiError, type GiteaClient } from './client';

export type ApprovalState = 'working' | 'in_review' | 'changes_requested' | 'approved' | 'published';

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
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
}

export interface MergePullRequestParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  pullNumber: number;
  mergeStyle: 'merge' | 'squash' | 'rebase' | 'rebase-merge' | 'fast-forward-only' | 'manually-merged';
  message?: string;
}

export interface ListPullRequestsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  state: 'open' | 'closed' | 'all';
  page?: number;
  limit?: number;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const responseLike = error as {
      error?: unknown;
      message?: unknown;
      statusText?: unknown;
    };

    if (typeof responseLike.message === 'string' && responseLike.message.trim() !== '') {
      return responseLike.message;
    }

    if (typeof responseLike.error === 'string' && responseLike.error.trim() !== '') {
      return responseLike.error;
    }

    if (
      typeof responseLike.error === 'object' &&
      responseLike.error !== null &&
      'message' in responseLike.error &&
      typeof (responseLike.error as { message?: unknown }).message === 'string'
    ) {
      return (responseLike.error as { message: string }).message;
    }

    if (typeof responseLike.statusText === 'string' && responseLike.statusText.trim() !== '') {
      return responseLike.statusText;
    }
  }

  return 'Gitea request failed.';
}

function toGiteaApiError(error: unknown): GiteaApiError {
  if (error instanceof GiteaApiError) {
    return error;
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;

  return new GiteaApiError(Number.isFinite(status) ? status : 0, readErrorMessage(error));
}

function toApprovalStateFromReview(review: PullReview): ApprovalState | null {
  const state = review.state?.toUpperCase();

  if (state === 'REQUEST_CHANGES' || state === 'CHANGES_REQUESTED') {
    return 'changes_requested';
  }

  if (state === 'APPROVED') {
    return 'approved';
  }

  return null;
}

function isMergedPullRequest(pullRequest: PullRequest): boolean {
  const candidate = pullRequest as {
    merged?: unknown;
    merged_at?: unknown;
  };

  return candidate.merged === true || (typeof candidate.merged_at === 'string' && candidate.merged_at.trim() !== '');
}

function resolveApprovalState(pullRequest: PullRequest, reviews: PullReview[]): ApprovalState {
  if (isMergedPullRequest(pullRequest)) {
    return 'published';
  }

  const reviewStates = reviews.map(toApprovalStateFromReview);
  if (reviewStates.includes('changes_requested')) {
    return 'changes_requested';
  }

  if (reviewStates.includes('approved')) {
    return 'approved';
  }

  return pullRequest.state === 'open' ? 'in_review' : 'working';
}

function withApprovalState(pullRequest: PullRequest, reviews: PullReview[]): PullRequestWithApprovalState {
  return {
    ...pullRequest,
    approvalState: resolveApprovalState(pullRequest, reviews),
  };
}

async function listAllPullRequests(client: GiteaClient, owner: string, repo: string, state: 'open' | 'closed' | 'all'): Promise<PullRequest[]> {
  const allPullRequests: PullRequest[] = [];
  const limit = 100;

  for (let page = 1; page < 100; page += 1) {
    const response = await client.repos.repoListPullRequests(owner, repo, {
      state,
      page,
      limit,
    });

    allPullRequests.push(...response.data);

    if (response.data.length < limit) {
      break;
    }
  }

  return allPullRequests;
}

function pullRequestSelectionRank(pullRequest: PullRequest): number {
  const openBonus = pullRequest.state === 'open' ? 1_000_000 : 0;
  const numberRank = pullRequest.number ?? 0;
  return openBonus + numberRank;
}

function selectPullRequestForBranch(pullRequests: PullRequest[], branch: string): PullRequest | null {
  const candidates = pullRequests.filter((candidate) => candidate.head?.ref === branch);
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => pullRequestSelectionRank(right) - pullRequestSelectionRank(left));
  return candidates[0] ?? null;
}

async function listPullReviews(client: GiteaClient, owner: string, repo: string, pullNumber: number): Promise<PullReview[]> {
  const allReviews: PullReview[] = [];
  const limit = 100;

  for (let page = 1; page < 100; page += 1) {
    const response = await client.repos.repoListPullReviews(owner, repo, pullNumber, {
      limit,
      page,
    });

    allReviews.push(...response.data);

    if (response.data.length < limit) {
      break;
    }
  }

  return allReviews;
}

export async function createPullRequest(params: CreatePullRequestParams): Promise<PullRequestWithApprovalState> {
  const { client, owner, repo, title, head, base, body } = params;

  try {
    const requestBody: CreatePullRequestOption = {
      title,
      head,
      base,
      body: body ?? '',
    };

    const response = await client.repos.repoCreatePullRequest(owner, repo, requestBody);
    const pullRequest = response.data;
    const reviews = pullRequest.number ? await listPullReviews(client, owner, repo, pullRequest.number) : [];

    return withApprovalState(pullRequest, reviews);
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function getPullRequestForBranch(
  params: GetPullRequestForBranchParams
): Promise<PullRequestWithApprovalState | null> {
  const { client, owner, repo, branch } = params;

  try {
    const pullRequests = await listAllPullRequests(client, owner, repo, 'all');
    const pullRequest = selectPullRequestForBranch(pullRequests, branch);

    if (!pullRequest || !pullRequest.number) {
      return null;
    }

    const reviews = await listPullReviews(client, owner, repo, pullRequest.number);
    return withApprovalState(pullRequest, reviews);
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function submitReview(params: SubmitReviewParams): Promise<PullReview> {
  const { client, owner, repo, pullNumber, event, body } = params;

  try {
    const requestBody: CreatePullReviewOptions = {
      event,
      ...(body ? { body } : {}),
    };

    const response = await client.repos.repoCreatePullReview(owner, repo, pullNumber, requestBody);
    return response.data;
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function mergePullRequest(params: MergePullRequestParams): Promise<void> {
  const { client, owner, repo, pullNumber, mergeStyle, message } = params;

  try {
    const requestBody: MergePullRequestOption = {
      Do: mergeStyle,
      ...(message ? { MergeMessageField: message } : {}),
    };

    await client.repos.repoMergePullRequest(owner, repo, pullNumber, requestBody);
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function listPullRequests(params: ListPullRequestsParams): Promise<PullRequestWithApprovalState[]> {
  const { client, owner, repo, state, page, limit } = params;

  try {
    const response = await client.repos.repoListPullRequests(owner, repo, {
      state,
      page,
      limit,
    });

    const mapped = await Promise.all(
      response.data.map(async (pullRequest) => {
        const reviews = pullRequest.number ? await listPullReviews(client, owner, repo, pullRequest.number) : [];
        return withApprovalState(pullRequest, reviews);
      })
    );

    return mapped;
  } catch (error) {
    throw toGiteaApiError(error);
  }
}
