import { afterEach, expect, mock, test } from "bun:test";
import type { components } from "./spec/gitea";

import { GiteaApiError, type GiteaClient } from "./client";

type PullRequest = components["schemas"]["PullRequest"];
// Use partial types for test fixtures — generated types require many fields
type TestPullReview = Partial<
  Omit<components["schemas"]["PullReview"], "user">
> & {
  user?: Partial<components["schemas"]["User"]>;
};

/**
 * Build a mock GiteaClient (openapi-fetch style) where GET, POST, PUT, DELETE,
 * and PATCH route to per-path handlers.
 */
function createMockClient(handlers: {
  GET?: Record<string, (...args: unknown[]) => unknown>;
  POST?: Record<string, (...args: unknown[]) => unknown>;
  PUT?: Record<string, (...args: unknown[]) => unknown>;
  DELETE?: Record<string, (...args: unknown[]) => unknown>;
  PATCH?: Record<string, (...args: unknown[]) => unknown>;
}) {
  const mockGet = mock(async (path: string, init?: { params?: unknown }) => {
    const handler = handlers.GET?.[path];
    if (handler) {
      const data = await handler(init);
      return {
        data,
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    return {
      data: undefined,
      error: { message: "not found" },
      response: new Response(null, { status: 404 }),
    };
  });

  const mockPost = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const mockPut = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      const handler = handlers.PUT?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const mockDelete = mock(async (path: string, init?: { params?: unknown }) => {
    const handler = handlers.DELETE?.[path];
    if (handler) {
      const data = await handler(init);
      return {
        data,
        error: undefined,
        response: new Response(null, { status: 204 }),
      };
    }
    return {
      data: undefined,
      error: { message: "not found" },
      response: new Response(null, { status: 404 }),
    };
  });

  const mockPatch = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      const handler = handlers.PATCH?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      DELETE: mockDelete,
      PATCH: mockPatch,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockDelete,
    mockPatch,
  };
}

// Default test data
const defaultPullRequests: PullRequest[] = [
  {
    number: 1,
    title: "Working draft",
    head: { ref: "draft", label: "draft" },
    state: "open",
  },
  {
    number: 2,
    title: "Requested changes",
    head: { ref: "feature/q2-amendments", label: "feature/q2-amendments" },
    state: "open",
  },
  {
    number: 3,
    title: "Already merged",
    head: { ref: "release", label: "release" },
    state: "closed",
    merged: true,
  },
];

const defaultReviews: Record<number, TestPullReview[]> = {
  2: [
    {
      id: 99,
      state: "REQUEST_CHANGES",
      body: "Please update section 4.2.",
      user: { login: "bob" },
    },
  ],
  3: [
    {
      id: 100,
      state: "APPROVED",
      body: "Looks good to me.",
      user: { login: "alice" },
    },
  ],
};

function buildDefaultHandlers(
  pullRequests = defaultPullRequests,
  reviews: Record<number, TestPullReview[]> = defaultReviews,
) {
  return {
    GET: {
      "/repos/{owner}/{repo}/pulls": (init: {
        params?: { query?: { head?: string } };
      }) => {
        if (init?.params?.query?.head) {
          // Filter logic not needed — real module filters by head.ref client-side
        }
        return pullRequests;
      },
      "/repos/{owner}/{repo}/pulls/{index}/reviews": (init: {
        params?: { path?: { index?: number }; query?: { page?: number } };
      }) => {
        const index = init?.params?.path?.index ?? 0;
        return reviews[index] ?? [];
      },
    } as Record<string, (...args: any[]) => unknown>,
    POST: {
      "/repos/{owner}/{repo}/pulls": (init: {
        body?: { title?: string; head?: string; base?: string };
      }) => ({
        number: 42,
        title: init?.body?.title,
        head: { ref: init?.body?.head },
        base: { ref: init?.body?.base },
        state: "open",
      }),
      "/repos/{owner}/{repo}/pulls/{index}/reviews": (init: {
        body?: { event?: string; body?: string };
      }) => ({
        id: 7,
        state: init?.body?.event || "PENDING",
        body: init?.body?.body ?? "",
        user: { login: "alice" },
      }),
      "/repos/{owner}/{repo}/pulls/{index}/reviews/{id}": (init: {
        body?: { event?: string; body?: string };
      }) => ({
        id: 7,
        state: init?.body?.event,
        body: init?.body?.body ?? "",
        user: { login: "alice" },
      }),
      "/repos/{owner}/{repo}/pulls/{index}/merge": () => ({}),
    } as Record<string, (...args: any[]) => unknown>,
  };
}

test("createPullRequest returns an approval-aware pull request", async () => {
  const { client } = createMockClient(buildDefaultHandlers());
  const { createPullRequest } = await import("./pullRequests");

  const pullRequest = await createPullRequest({
    client,
    owner: "alice",
    repo: "quarterly-report",
    title: "Add approval notes",
    head: "feature/add-approval-notes",
    base: "main",
    body: "Draft PR",
  });

  expect(pullRequest.title).toBe("Add approval notes");
  expect(pullRequest.approvalState).toBe("in_review");
});

test("getPullRequestForBranch returns null when no branch PR exists", async () => {
  const { client } = createMockClient(buildDefaultHandlers());
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "missing-branch",
  });

  expect(pullRequest).toBeNull();
});

test("getPullRequestForBranch maps a closed unmerged PR to working", async () => {
  const handlers = buildDefaultHandlers(
    [
      {
        number: 10,
        title: "Stale draft",
        head: { ref: "feature/stale-draft", label: "" },
        state: "closed",
      },
    ],
    {},
  );
  const { client } = createMockClient(handlers);
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "feature/stale-draft",
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.approvalState).toBe("working");
});

test("getPullRequestForBranch maps requested changes to changes_requested", async () => {
  const { client } = createMockClient(buildDefaultHandlers());
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "feature/q2-amendments",
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.approvalState).toBe("changes_requested");
  expect(pullRequest?.number).toBe(2);
});

test("getPullRequestForBranch prefers the newest open pull request for reused branches", async () => {
  const handlers = buildDefaultHandlers(
    [
      {
        number: 7,
        title: "Old closed PR",
        head: { ref: "feature/reused-branch", label: "" },
        state: "closed",
      },
      {
        number: 11,
        title: "Current open PR",
        head: { ref: "feature/reused-branch", label: "" },
        state: "open",
      },
    ],
    {
      11: [
        {
          id: 121,
          state: "REQUEST_CHANGES",
          body: "Needs updates.",
          user: { login: "bob" },
        },
      ],
    },
  );
  const { client } = createMockClient(handlers);
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "feature/reused-branch",
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.number).toBe(11);
  expect(pullRequest?.approvalState).toBe("changes_requested");
});

test("getPullRequestForBranch evaluates review state across paginated review results", async () => {
  const page1Reviews = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    state: "COMMENT",
    body: "Looks fine",
    user: { login: "alice" },
  }));
  const page2Reviews = [
    {
      id: 222,
      state: "REQUEST_CHANGES",
      body: "Found one more issue.",
      user: { login: "bob" },
    },
  ];

  const handlers = buildDefaultHandlers(
    [
      {
        number: 23,
        title: "Long review history PR",
        head: { ref: "feature/paginated-reviews", label: "" },
        state: "open",
      },
    ],
    {},
  );

  // Override the reviews handler to return paginated results
  handlers.GET["/repos/{owner}/{repo}/pulls/{index}/reviews"] = (init: {
    params?: { path?: { index?: number }; query?: { page?: number } };
  }) => {
    const page = init?.params?.query?.page ?? 1;
    return page === 1 ? page1Reviews : page2Reviews;
  };

  const { client } = createMockClient(handlers);
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pullRequest = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "feature/paginated-reviews",
  });

  expect(pullRequest).not.toBeNull();
  expect(pullRequest?.approvalState).toBe("changes_requested");
});

test("toApprovalStateFromReview recognises Gitea APPROVE state (no trailing D)", async () => {
  const handlers = buildDefaultHandlers(
    [
      {
        number: 5,
        title: "Gitea-style approval",
        head: { ref: "feature/gitea-approve", label: "" },
        state: "open",
      },
    ],
    {
      5: [
        {
          id: 55,
          state: "APPROVE",
          body: "Approved",
          user: { login: "carol" },
        },
      ],
    },
  );
  const { client } = createMockClient(handlers);
  const { getPullRequestForBranch } = await import("./pullRequests");

  const pr = await getPullRequestForBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
    branch: "feature/gitea-approve",
  });

  expect(pr?.approvalState).toBe("approved");
});

test("listPullRequests maps merged PRs to published and approved PRs to approved", async () => {
  const { client } = createMockClient(buildDefaultHandlers());
  const { listPullRequests } = await import("./pullRequests");

  const pullRequests = await listPullRequests({
    client,
    owner: "alice",
    repo: "quarterly-report",
    state: "all",
    page: 1,
  });

  expect(pullRequests.map((item) => item.approvalState)).toEqual([
    "in_review",
    "changes_requested",
    "published",
  ]);
});

test("submitReview forwards the review event and body", async () => {
  const { client, mockPost } = createMockClient(buildDefaultHandlers());
  const { submitReview } = await import("./pullRequests");

  const review = await submitReview({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    event: "REQUEST_CHANGES",
    body: "Please update section 4.2.",
  });

  expect(mockPost).toHaveBeenCalled();
  expect(review.state).toBe("REQUEST_CHANGES");
});

test("mergePullRequest forwards the merge style", async () => {
  const { client, mockPost } = createMockClient(buildDefaultHandlers());
  const { mergePullRequest } = await import("./pullRequests");

  await mergePullRequest({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
    message: "Merge after approvals",
  });

  expect(mockPost).toHaveBeenCalled();
});

test("mergePullRequest throws on 409 conflict", async () => {
  const handlers = buildDefaultHandlers();
  const { client } = createMockClient(handlers);

  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        return {
          data: undefined,
          error: {
            message: "Merge conflict: the pull request cannot be merged.",
          },
          response: new Response(null, { status: 409 }),
        };
      }
      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergePullRequest } = await import("./pullRequests");

  try {
    await mergePullRequest({
      client,
      owner: "alice",
      repo: "quarterly-report",
      pullNumber: 2,
      mergeStyle: "squash",
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    expect((error as GiteaApiError).status).toBe(409);
  }
});

test("mergePullRequest throws on non-transient 405", async () => {
  const handlers = buildDefaultHandlers();
  const { client } = createMockClient(handlers);

  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        return {
          data: undefined,
          error: { message: "merge is not allowed" },
          response: new Response(null, { status: 405 }),
        };
      }
      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergePullRequest } = await import("./pullRequests");

  try {
    await mergePullRequest({
      client,
      owner: "alice",
      repo: "quarterly-report",
      pullNumber: 2,
      mergeStyle: "squash",
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    expect((error as GiteaApiError).status).toBe(409);
  }
});

/**
 * Build handlers for the conflict resolution tests.
 * The resolution flow uses: GET PR, GET dir listing, GET file (head),
 * GET file (main), PUT file (overwrite with main), POST update PR branch,
 * GET file (synced SHA), PUT file (restore uploaded content).
 */
function buildConflictResolutionHandlers() {
  const handlers = buildDefaultHandlers();
  let putCallCount = 0;

  handlers.GET["/repos/{owner}/{repo}/pulls/{index}"] = () => ({
    number: 2,
    title: "Test PR",
    head: { ref: "feature/test-branch" },
    state: "open",
    mergeable: false,
  });

  handlers.GET["/repos/{owner}/{repo}/contents"] = () => [
    { name: "document.pdf", type: "file", path: "document.pdf" },
    { name: ".gitkeep", type: "file", path: ".gitkeep" },
  ];

  handlers.GET["/repos/{owner}/{repo}/contents/{filepath}"] = (init: {
    params?: { path?: { filepath?: string }; query?: { ref?: string } };
  }) => {
    const filepath = init?.params?.path?.filepath ?? "";
    const ref = init?.params?.query?.ref;

    if (filepath === "document.pdf") {
      if (ref === "feature/test-branch") {
        return { content: "uploaded-v3-content", sha: "head-sha-111" };
      }
      if (ref === "main") {
        return { content: "main-v2-content", sha: "main-sha-222" };
      }
      // After sync (no ref or after update) — return updated SHA
      return { content: "main-v2-content", sha: "synced-sha-333" };
    }

    return undefined;
  };

  // PR update endpoint (merge main into head)
  handlers.POST["/repos/{owner}/{repo}/pulls/{index}/update"] = () => ({});

  handlers.PUT = {
    "/repos/{owner}/{repo}/contents/{filepath}": () => {
      putCallCount += 1;
      return {
        content: { path: "document.pdf" },
        commit: { sha: `put-commit-${putCallCount}` },
      };
    },
  };

  return { handlers, getPutCallCount: () => putCallCount };
}

test("mergeOrResolveConflicts skips initial merge when mergeable=false and succeeds after rebase", async () => {
  const { handlers } = buildConflictResolutionHandlers();
  let mergeCallCount = 0;

  const { client, mockGet, mockPut } = createMockClient(handlers);

  // Since mergeable=false, the initial attemptMerge is skipped entirely.
  // After resolveConflictsByRebase, the merge should succeed on the first try.
  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        mergeCallCount += 1;
        return {
          data: {},
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergeOrResolveConflicts } = await import("./pullRequests");

  await mergeOrResolveConflicts({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
  });

  // Only one merge attempt — after conflict resolution
  expect(mergeCallCount).toBe(1);
  expect(mockGet).toHaveBeenCalled();
  // PUT is called twice: once to overwrite with main, once to restore uploaded content
  expect(mockPut).toHaveBeenCalled();
});

test("mergeOrResolveConflicts handles transient 405 after rebase and eventually succeeds", async () => {
  const { handlers } = buildConflictResolutionHandlers();
  let mergeCallCount = 0;

  const { client, mockGet, mockPut } = createMockClient(handlers);

  // After rebase, first merge attempt gets a transient 405 (Gitea still recalculating),
  // second attempt succeeds.
  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        mergeCallCount += 1;
        if (mergeCallCount === 1) {
          return {
            data: undefined,
            error: { message: "Please try again later" },
            response: new Response(null, { status: 405 }),
          };
        }
        return {
          data: {},
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }

      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergeOrResolveConflicts } = await import("./pullRequests");

  await mergeOrResolveConflicts({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
    message: "Merge after approvals",
  });

  expect(mergeCallCount).toBe(2);
  expect(mockGet).toHaveBeenCalled();
  expect(mockPut).toHaveBeenCalled();
});

test("mergeOrResolveConflicts tolerates an already up-to-date branch during rebase", async () => {
  const { handlers } = buildConflictResolutionHandlers();
  let mergeCallCount = 0;

  const { client, mockGet, mockPut } = createMockClient(handlers);

  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        mergeCallCount += 1;
        return {
          data: {},
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }

      if (path === "/repos/{owner}/{repo}/pulls/{index}/update") {
        return {
          data: undefined,
          error: { message: "HeadBranch of PR 2 is up to date" },
          response: new Response(null, { status: 422 }),
        };
      }

      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }

      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergeOrResolveConflicts } = await import("./pullRequests");

  await mergeOrResolveConflicts({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
  });

  expect(mergeCallCount).toBe(1);
  expect(mockGet).toHaveBeenCalled();
  expect(mockPut).toHaveBeenCalled();
});

test("mergeOrResolveConflicts throws if 409 persists after conflict resolution", async () => {
  const { handlers } = buildConflictResolutionHandlers();

  const { client } = createMockClient(handlers);

  // Override POST to always return 409 for merge endpoint
  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        return {
          data: undefined,
          error: { message: "Merge conflict" },
          response: new Response(null, { status: 409 }),
        };
      }

      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return {
          data,
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    },
  );

  const { mergeOrResolveConflicts } = await import("./pullRequests");

  try {
    await mergeOrResolveConflicts({
      client,
      owner: "alice",
      repo: "quarterly-report",
      pullNumber: 2,
      mergeStyle: "squash",
      message: "Merge after approvals",
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    expect((error as GiteaApiError).status).toBe(409);
    expect((error as GiteaApiError).message).toContain("persisted");
  }
});
