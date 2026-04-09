import { afterEach, expect, mock, test } from "bun:test";
import type { components } from "./spec/gitea";

import { GiteaApiError, type GiteaClient } from "./client";

type PullRequest = components["schemas"]["PullRequest"];
// Use partial types for test fixtures — generated types require many fields
type TestPullReview = Partial<Omit<components["schemas"]["PullReview"], "user">> & {
  user?: Partial<components["schemas"]["User"]>;
};

/**
 * Build a mock GiteaClient (openapi-fetch style) where GET, POST, PUT, and DELETE
 * route to per-path handlers.
 */
function createMockClient(handlers: {
  GET?: Record<string, (...args: unknown[]) => unknown>;
  POST?: Record<string, (...args: unknown[]) => unknown>;
  PUT?: Record<string, (...args: unknown[]) => unknown>;
  DELETE?: Record<string, (...args: unknown[]) => unknown>;
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

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      DELETE: mockDelete,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockDelete,
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
    { id: 222, state: "REQUEST_CHANGES", body: "Found one more issue.", user: { login: "bob" } },
  ];

  const handlers = buildDefaultHandlers(
    [{ number: 23, title: "Long review history PR", head: { ref: "feature/paginated-reviews", label: "" }, state: "open" }],
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
    [{ number: 5, title: "Gitea-style approval", head: { ref: "feature/gitea-approve", label: "" }, state: "open" }],
    { 5: [{ id: 55, state: "APPROVE", body: "Approved", user: { login: "carol" } }] },
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

test("mergePullRequest with resolveConflicts=true succeeds when there is no conflict", async () => {
  const { client } = createMockClient(buildDefaultHandlers());
  const { mergePullRequest } = await import("./pullRequests");

  // Should not throw, should return cleanly
  await mergePullRequest({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
    message: "Merge after approvals",
    resolveConflicts: true,
  });
});

test("mergePullRequest without resolveConflicts throws on 409 conflict", async () => {
  const handlers = buildDefaultHandlers();
  const { client } = createMockClient(handlers);

  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        return {
          data: undefined,
          error: { message: "Merge conflict: the pull request cannot be merged." },
          response: new Response(null, { status: 409 }),
        };
      }
      const handler = handlers.POST?.[path];
      if (handler) {
        const data = await handler(init);
        return { data, error: undefined, response: new Response(null, { status: 200 }) };
      }
      return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
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
      resolveConflicts: false,
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    expect((error as GiteaApiError).status).toBe(409);
  }
});

test("mergePullRequest without resolveConflicts throws on non-transient 405", async () => {
  const handlers = buildDefaultHandlers();
  const { client } = createMockClient(handlers);

  // Gitea returns 405 for actual merge conflicts (not just transient states)
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
        return { data, error: undefined, response: new Response(null, { status: 200 }) };
      }
      return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
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
      resolveConflicts: false,
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    // Non-transient 405 is treated as a conflict
    expect((error as GiteaApiError).status).toBe(409);
  }
});

test("mergePullRequest with resolveConflicts=true resolves non-transient 405 and retries", async () => {
  const handlers = buildDefaultHandlers();
  let mergeCallCount = 0;

  handlers.GET["/repos/{owner}/{repo}/pulls/{index}"] = () => ({
    number: 2,
    title: "Test PR",
    head: { ref: "feature/test-branch" },
    state: "open",
  });

  handlers.GET["/repos/{owner}/{repo}/contents/{filepath}"] = (init: {
    params?: { path?: { filepath?: string }; query?: { ref?: string } };
  }) => {
    const filepath = init?.params?.path?.filepath ?? "";
    const ref = init?.params?.query?.ref;
    if (filepath === "") {
      return [{ name: "document.pdf", type: "file", path: "document.pdf" }];
    }
    if (filepath === "document.pdf") {
      if (ref === "feature/test-branch") {
        return { content: "base64-encoded-pdf-content", sha: "abc123" };
      }
      return { content: "old-content", sha: "def456" };
    }
    return undefined;
  };

  handlers.DELETE = {
    "/repos/{owner}/{repo}/branches/{branch}": () => ({}),
  };

  handlers.POST["/repos/{owner}/{repo}/branches"] = () => ({
    name: "feature/test-branch",
  });

  handlers.PUT = {
    "/repos/{owner}/{repo}/contents/{filepath}": () => ({
      content: { path: "document.pdf" },
      commit: { sha: "new-commit-sha" },
    }),
  };

  const { client, mockGet, mockPut, mockDelete } = createMockClient(handlers);

  // First merge returns 405 (non-transient — actual conflict), second succeeds
  client.POST = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        mergeCallCount += 1;
        if (mergeCallCount === 1) {
          return {
            data: undefined,
            error: { message: "merge is not allowed" },
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
        return { data, error: undefined, response: new Response(null, { status: 200 }) };
      }
      return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
    },
  );

  const { mergePullRequest } = await import("./pullRequests");

  await mergePullRequest({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
    resolveConflicts: true,
  });

  expect(mergeCallCount).toBe(2);
  expect(mockGet).toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalled();
  expect(mockPut).toHaveBeenCalled();
});

test("mergePullRequest with resolveConflicts=true resolves 409 and retries", async () => {
  const handlers = buildDefaultHandlers();

  let mergeCallCount = 0;

  // Add handler for getting the PR
  handlers.GET["/repos/{owner}/{repo}/pulls/{index}"] = () => ({
    number: 2,
    title: "Test PR",
    head: { ref: "feature/test-branch" },
    state: "open",
  });

  // Add handler for listing files on the head branch
  handlers.GET["/repos/{owner}/{repo}/contents/{filepath}"] = (init: {
    params?: { path?: { filepath?: string }; query?: { ref?: string } };
  }) => {
    const filepath = init?.params?.path?.filepath ?? "";
    const ref = init?.params?.query?.ref;

    // Directory listing when filepath is ""
    if (filepath === "") {
      return [
        { name: "document.pdf", type: "file", path: "document.pdf" },
        { name: ".gitkeep", type: "file", path: ".gitkeep" },
      ];
    }

    // File content when filepath is "document.pdf"
    if (filepath === "document.pdf") {
      if (ref === "feature/test-branch") {
        // Reading from head branch
        return { content: "base64-encoded-pdf-content", sha: "abc123" };
      }
      // Reading from recreated branch (checking for existing file)
      return { content: "old-content", sha: "def456" };
    }

    return undefined;
  };

  // Add handler for deleting the branch
  handlers.DELETE = {
    "/repos/{owner}/{repo}/branches/{branch}": () => ({}),
  };

  // Add handler for creating the branch
  handlers.POST["/repos/{owner}/{repo}/branches"] = (init: {
    body?: { new_branch_name?: string; old_branch_name?: string };
  }) => ({
    name: init?.body?.new_branch_name,
  });

  // Add handler for updating the file
  handlers.PUT = {
    "/repos/{owner}/{repo}/contents/{filepath}": () => ({
      content: { path: "document.pdf" },
      commit: { sha: "new-commit-sha" },
    }),
  };

  const { client, mockGet, mockPost, mockPut, mockDelete } = createMockClient(handlers);

  // Override POST to track merge calls and return 409 on first call, 200 on second
  const mockPostWithConflict = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      if (path === "/repos/{owner}/{repo}/pulls/{index}/merge") {
        mergeCallCount += 1;
        if (mergeCallCount === 1) {
          // First call: return 409
          return {
            data: undefined,
            error: { message: "Merge conflict" },
            response: new Response(null, { status: 409 }),
          };
        }
        // Second call: succeed
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

  client.POST = mockPostWithConflict;

  const { mergePullRequest } = await import("./pullRequests");

  await mergePullRequest({
    client,
    owner: "alice",
    repo: "quarterly-report",
    pullNumber: 2,
    mergeStyle: "squash",
    message: "Merge after approvals",
    resolveConflicts: true,
  });

  // Verify the resolution workflow was executed
  expect(mergeCallCount).toBe(2);
  expect(mockGet).toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalled();
  expect(mockPostWithConflict).toHaveBeenCalled();
  expect(mockPut).toHaveBeenCalled();
});

test("mergePullRequest throws if 409 persists after conflict resolution", async () => {
  const handlers = buildDefaultHandlers();

  // Add handler for getting the PR
  handlers.GET["/repos/{owner}/{repo}/pulls/{index}"] = () => ({
    number: 2,
    title: "Test PR",
    head: { ref: "feature/test-branch" },
    state: "open",
  });

  // Add handler for listing files on the head branch
  handlers.GET["/repos/{owner}/{repo}/contents/{filepath}"] = (init: {
    params?: { path?: { filepath?: string }; query?: { ref?: string } };
  }) => {
    const filepath = init?.params?.path?.filepath ?? "";
    const ref = init?.params?.query?.ref;

    if (filepath === "") {
      return [
        { name: "document.pdf", type: "file", path: "document.pdf" },
      ];
    }

    if (filepath === "document.pdf") {
      if (ref === "feature/test-branch") {
        return { content: "base64-encoded-pdf-content", sha: "abc123" };
      }
      return { content: "old-content", sha: "def456" };
    }

    return undefined;
  };

  handlers.DELETE = {
    "/repos/{owner}/{repo}/branches/{branch}": () => ({}),
  };

  handlers.POST["/repos/{owner}/{repo}/branches"] = () => ({
    name: "feature/test-branch",
  });

  handlers.PUT = {
    "/repos/{owner}/{repo}/contents/{filepath}": () => ({
      content: { path: "document.pdf" },
      commit: { sha: "new-commit-sha" },
    }),
  };

  const { client } = createMockClient(handlers);

  // Override POST to always return 409 for merge endpoint
  const mockPostAlwaysConflict = mock(
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

  client.POST = mockPostAlwaysConflict;

  const { mergePullRequest } = await import("./pullRequests");

  try {
    await mergePullRequest({
      client,
      owner: "alice",
      repo: "quarterly-report",
      pullNumber: 2,
      mergeStyle: "squash",
      message: "Merge after approvals",
      resolveConflicts: true,
    });
    throw new Error("Should have thrown GiteaApiError");
  } catch (error) {
    expect(error).toBeInstanceOf(GiteaApiError);
    expect((error as GiteaApiError).status).toBe(409);
    expect((error as GiteaApiError).message).toContain("persisted");
  }
});
