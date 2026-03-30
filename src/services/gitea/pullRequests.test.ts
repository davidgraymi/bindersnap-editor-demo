import { afterEach, expect, mock, test } from 'bun:test';
import type { CreatePullRequestOption, CreatePullReviewOptions, MergePullRequestOption, PullRequest, PullReview } from 'gitea-js';

import type { GiteaClient } from './client';

const repoCreatePullRequestMock = mock(async (_owner: string, _repo: string, body: CreatePullRequestOption) => ({
  data: {
    number: 42,
    title: body.title,
    head: { ref: body.head },
    base: { ref: body.base },
    state: 'open',
    merged: false,
  } as PullRequest,
}));

const repoListPullRequestsMock = mock(async () => ({
  data: [
    {
      number: 1,
      title: 'Working draft',
      head: { ref: 'draft' },
      state: 'open',
      merged: false,
    },
    {
      number: 2,
      title: 'Requested changes',
      head: { ref: 'feature/q2-amendments' },
      state: 'open',
      merged: false,
    },
    {
      number: 3,
      title: 'Already merged',
      head: { ref: 'release' },
      state: 'closed',
      merged: true,
      merged_at: '2026-03-30T12:00:00Z',
    },
  ] as PullRequest[],
}));

const repoListPullReviewsMock = mock(async (_owner: string, _repo: string, index: number) => ({
  data:
    index === 2
      ? [
          {
            id: 99,
            state: 'REQUEST_CHANGES',
            body: 'Please update section 4.2.',
            user: { login: 'bob' },
          } as PullReview,
        ]
      : index === 3
        ? [
            {
              id: 100,
              state: 'APPROVED',
              body: 'Looks good to me.',
              user: { login: 'alice' },
            } as PullReview,
          ]
        : ([] as PullReview[]),
}));

const repoCreatePullReviewMock = mock(async (_owner: string, _repo: string, _index: number, body: CreatePullReviewOptions) => ({
  data: {
    id: 7,
    state: body.event,
    body: body.body ?? '',
    user: { login: 'alice' },
  } as PullReview,
}));

const repoMergePullRequestMock = mock(async () => ({
  data: {},
}));

const client = {
  repos: {
    repoCreatePullRequest: repoCreatePullRequestMock,
    repoListPullRequests: repoListPullRequestsMock,
    repoListPullReviews: repoListPullReviewsMock,
    repoCreatePullReview: repoCreatePullReviewMock,
    repoMergePullRequest: repoMergePullRequestMock,
  },
} as unknown as GiteaClient;

afterEach(() => {
  repoCreatePullRequestMock.mockReset();
  repoListPullRequestsMock.mockReset();
  repoListPullReviewsMock.mockReset();
  repoCreatePullReviewMock.mockReset();
  repoMergePullRequestMock.mockReset();

  repoCreatePullRequestMock.mockImplementation(async (_owner: string, _repo: string, body: CreatePullRequestOption) => ({
    data: {
      number: 42,
      title: body.title,
      head: { ref: body.head },
      base: { ref: body.base },
      state: 'open',
      merged: false,
    } as PullRequest,
  }));

  repoListPullRequestsMock.mockImplementation(async () => ({
    data: [
      {
        number: 1,
        title: 'Working draft',
        head: { ref: 'draft' },
        state: 'open',
        merged: false,
      },
      {
        number: 2,
        title: 'Requested changes',
        head: { ref: 'feature/q2-amendments' },
        state: 'open',
        merged: false,
      },
      {
        number: 3,
        title: 'Already merged',
        head: { ref: 'release' },
        state: 'closed',
        merged: true,
        merged_at: '2026-03-30T12:00:00Z',
      },
    ] as PullRequest[],
  }));

  repoListPullReviewsMock.mockImplementation(async (_owner: string, _repo: string, index: number) => ({
    data:
      index === 2
        ? [
            {
              id: 99,
              state: 'REQUEST_CHANGES',
              body: 'Please update section 4.2.',
              user: { login: 'bob' },
            } as PullReview,
          ]
        : index === 3
          ? [
              {
                id: 100,
                state: 'APPROVED',
                body: 'Looks good to me.',
                user: { login: 'alice' },
              } as PullReview,
            ]
          : ([] as PullReview[]),
  }));

  repoCreatePullReviewMock.mockImplementation(async (_owner: string, _repo: string, _index: number, body: CreatePullReviewOptions) => ({
    data: {
      id: 7,
      state: body.event,
      body: body.body ?? '',
      user: { login: 'alice' },
    } as PullReview,
  }));

  repoMergePullRequestMock.mockImplementation(async () => ({
    data: {},
  }));
});

test('createPullRequest returns an approval-aware pull request', async () => {
  const { createPullRequest } = await import('./pullRequests');

  const pullRequest = await createPullRequest({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    title: 'Add approval notes',
    head: 'feature/add-approval-notes',
    base: 'main',
    body: 'Draft PR',
  });

  expect(repoCreatePullRequestMock).toHaveBeenCalledTimes(1);
  expect(repoCreatePullRequestMock).toHaveBeenCalledWith('alice', 'quarterly-report', {
    title: 'Add approval notes',
    head: 'feature/add-approval-notes',
    base: 'main',
    body: 'Draft PR',
  });
  expect(pullRequest.approvalState).toBe('in_review');
});

test('getPullRequestForBranch returns null when no branch PR exists', async () => {
  const { getPullRequestForBranch } = await import('./pullRequests');

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    branch: 'missing-branch',
  });

  expect(pullRequest).toBeNull();
});

test('getPullRequestForBranch maps requested changes to changes_requested', async () => {
  const { getPullRequestForBranch } = await import('./pullRequests');

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    branch: 'feature/q2-amendments',
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.approvalState).toBe('changes_requested');
  expect(pullRequest?.number).toBe(2);
});

test('getPullRequestForBranch prefers the newest open pull request for reused branches', async () => {
  const { getPullRequestForBranch } = await import('./pullRequests');

  repoListPullRequestsMock.mockImplementation(async () => ({
    data: [
      {
        number: 7,
        title: 'Old closed PR',
        head: { ref: 'feature/reused-branch' },
        state: 'closed',
        merged: false,
      },
      {
        number: 11,
        title: 'Current open PR',
        head: { ref: 'feature/reused-branch' },
        state: 'open',
        merged: false,
      },
    ] as PullRequest[],
  }));

  repoListPullReviewsMock.mockImplementation(async (_owner: string, _repo: string, index: number) => ({
    data:
      index === 11
        ? [
            {
              id: 121,
              state: 'REQUEST_CHANGES',
              body: 'Needs updates.',
              user: { login: 'bob' },
            } as PullReview,
          ]
        : ([] as PullReview[]),
  }));

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    branch: 'feature/reused-branch',
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.number).toBe(11);
  expect(pullRequest?.approvalState).toBe('changes_requested');
});

test('getPullRequestForBranch evaluates review state across paginated review results', async () => {
  const { getPullRequestForBranch } = await import('./pullRequests');

  repoListPullRequestsMock.mockImplementation(async () => ({
    data: [
      {
        number: 23,
        title: 'Long review history PR',
        head: { ref: 'feature/paginated-reviews' },
        state: 'open',
        merged: false,
      },
    ] as PullRequest[],
  }));

  repoListPullReviewsMock.mockImplementation(
    async (_owner: string, _repo: string, _index: number, query?: { page?: number }) => ({
      data:
        query?.page === 1
          ? Array.from({ length: 100 }, (_, offset) => ({
              id: offset + 1,
              state: 'COMMENT',
              body: 'Looks fine',
              user: { login: 'alice' },
            } as PullReview))
          : [
              {
                id: 222,
                state: 'REQUEST_CHANGES',
                body: 'Found one more issue.',
                user: { login: 'bob' },
              } as PullReview,
            ],
    }),
  );

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    branch: 'feature/paginated-reviews',
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.approvalState).toBe('changes_requested');
  expect(repoListPullReviewsMock).toHaveBeenCalledTimes(2);
});

test('listPullRequests maps merged PRs to published and approved PRs to approved', async () => {
  const { listPullRequests } = await import('./pullRequests');

  const pullRequests = await listPullRequests({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    state: 'all',
    page: 1,
    limit: 10,
  });

  expect(repoListPullRequestsMock).toHaveBeenCalledWith('alice', 'quarterly-report', {
    state: 'all',
    page: 1,
    limit: 10,
  });
  expect(pullRequests.map((item) => item.approvalState)).toEqual(['in_review', 'changes_requested', 'published']);
});

test('submitReview forwards the review event and body', async () => {
  const { submitReview } = await import('./pullRequests');

  const review = await submitReview({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    pullNumber: 2,
    event: 'REQUEST_CHANGES',
    body: 'Please update section 4.2.',
  });

  expect(repoCreatePullReviewMock).toHaveBeenCalledTimes(1);
  expect(repoCreatePullReviewMock).toHaveBeenCalledWith('alice', 'quarterly-report', 2, {
    event: 'REQUEST_CHANGES',
    body: 'Please update section 4.2.',
  });
  expect(review.state).toBe('REQUEST_CHANGES');
});

test('mergePullRequest forwards the merge style', async () => {
  const { mergePullRequest } = await import('./pullRequests');

  await mergePullRequest({
    client,
    owner: 'alice',
    repo: 'quarterly-report',
    pullNumber: 2,
    mergeStyle: 'squash',
    message: 'Merge after approvals',
  });

  expect(repoMergePullRequestMock).toHaveBeenCalledTimes(1);
  expect(repoMergePullRequestMock).toHaveBeenCalledWith('alice', 'quarterly-report', 2, {
    Do: 'squash',
    MergeMessageField: 'Merge after approvals',
  });
});
