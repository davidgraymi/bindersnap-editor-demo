import { expect, test } from "bun:test";
import { mock } from "bun:test";
import type { components } from "./spec/gitea";
import type { GiteaClient } from "./client";

// Use partial types for test fixtures — generated types require many fields
type Repository = Partial<
  Omit<components["schemas"]["Repository"], "owner">
> & {
  owner?: Partial<components["schemas"]["User"]>;
};
type Tag = Partial<components["schemas"]["Tag"]>;

function createMockClient(handlers: {
  GET?: Record<string, (...args: any[]) => unknown>;
  POST?: Record<string, (...args: any[]) => unknown>;
  DELETE?: Record<string, (...args: any[]) => unknown>;
  PUT?: Record<string, (...args: any[]) => unknown>;
}) {
  const mockGet = mock(async (path: string, init?: unknown) => {
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

  const mockDelete = mock(
    async (path: string, init?: { params?: unknown; body?: unknown }) => {
      const handler = handlers.DELETE?.[path];
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

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      DELETE: mockDelete,
      PUT: mockPut,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockDelete,
    mockPut,
  };
}

test("listRepoCollaborators loads collaborators and their permissions per page", async () => {
  const { client, mockGet } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/collaborators": () => [
        {
          id: 1,
          login: "alice",
          full_name: "Alice Example",
          email: "alice@example.com",
          avatar_url: "https://example.com/a.png",
        },
        {
          id: 2,
          login: "bob",
          full_name: "Bob Example",
          email: "bob@example.com",
          avatar_url: "https://example.com/b.png",
        },
      ],
      "/repos/{owner}/{repo}/collaborators/{collaborator}/permission": (init: {
        params?: { path?: { collaborator?: string } };
      }) => ({
        permission:
          init?.params?.path?.collaborator === "alice" ? "admin" : "write",
        role_name:
          init?.params?.path?.collaborator === "alice"
            ? "repo admin"
            : "collaborator",
        user: {
          login: init?.params?.path?.collaborator,
        },
      }),
    },
  });

  const { listRepoCollaborators } = await import("./repos");
  const result = await listRepoCollaborators({
    client,
    owner: "alice",
    repo: "quarterly-report",
    page: 2,
    limit: 2,
  });

  expect(mockGet).toHaveBeenCalledTimes(3);
  expect(result.page).toBe(2);
  expect(result.limit).toBe(2);
  expect(result.hasMore).toBe(true);
  expect(result.collaborators).toHaveLength(2);
  expect(result.collaborators[0]?.user.login).toBe("alice");
  expect(result.collaborators[0]?.permission).toBe("admin");
  expect(result.collaborators[0]?.access).toBe("admin");
  expect(result.collaborators[0]?.permissionLabel).toBe("Admin");
  expect(result.collaborators[1]?.user.full_name).toBe("Bob Example");
  expect(result.collaborators[1]?.permission).toBe("write");
});

test("getCurrentUserRepoPermission returns the current user's repository access", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/collaborators/{collaborator}/permission": () => ({
        permission: "owner",
        role_name: "repository owner",
        user: {
          login: "alice",
          full_name: "Alice Example",
          email: "alice@example.com",
          avatar_url: "https://example.com/a.png",
        },
      }),
    },
  });

  const { getCurrentUserRepoPermission } = await import("./repos");
  const permission = await getCurrentUserRepoPermission({
    client,
    owner: "alice",
    repo: "quarterly-report",
    username: "alice",
  });

  expect(permission.permission).toBe("owner");
  expect(permission.access).toBe("owner");
  expect(permission.permissionLabel).toBe("Owner");
  expect(permission.user.login).toBe("alice");
});

test("searchUsers returns normalized user results for typeahead", async () => {
  const { client } = createMockClient({
    GET: {
      "/users/search": (init: {
        params?: { query?: { q?: string; page?: number; limit?: number } };
      }) => ({
        data: [
          {
            id: 7,
            login: "jane",
            full_name: "Jane Doe",
            email: "jane@example.com",
            avatar_url: "https://example.com/jane.png",
          },
          {
            id: 8,
            login: "janet",
            full_name: "Janet Roe",
            email: "",
            avatar_url: "",
          },
        ],
        ok: true,
        query: init?.params?.query?.q,
      }),
    },
  });

  const { searchUsers } = await import("./repos");
  const result = await searchUsers({
    client,
    query: "jan",
    page: 1,
    limit: 5,
  });

  expect(result.page).toBe(1);
  expect(result.limit).toBe(5);
  expect(result.hasMore).toBe(false);
  expect(result.users).toHaveLength(2);
  expect(result.users[0]).toMatchObject({
    id: 7,
    login: "jane",
    full_name: "Jane Doe",
    email: "jane@example.com",
  });
});

test("bootstrapEmptyMainBranch deletes README.md from main when present", async () => {
  const { client, mockDelete } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({
        sha: "readme-sha",
        type: "file",
      }),
    },
    DELETE: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({}),
    },
  });

  const { bootstrapEmptyMainBranch } = await import("./repos");
  await bootstrapEmptyMainBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
  });

  expect(mockDelete).toHaveBeenCalled();
  const calls = mockDelete.mock.calls as Array<
    [string, { body?: { branch?: string; sha?: string; message?: string } }]
  >;
  expect(calls[0]?.[1]?.body).toMatchObject({
    branch: "main",
    sha: "readme-sha",
    message: "Bootstrap empty main branch",
  });
});

test("bootstrapEmptyMainBranch is a no-op when README.md is missing", async () => {
  const { client, mockDelete } = createMockClient({});

  const { bootstrapEmptyMainBranch } = await import("./repos");
  await bootstrapEmptyMainBranch({
    client,
    owner: "alice",
    repo: "quarterly-report",
  });

  expect(mockDelete).not.toHaveBeenCalled();
});

test("getLatestDocTag returns the highest version tag", async () => {
  const tags: Tag[] = [
    {
      name: "doc/v0001",
      commit: { sha: "aaa", created: "2026-03-01T00:00:00Z" },
    },
    {
      name: "doc/v0003",
      commit: { sha: "ccc", created: "2026-03-20T00:00:00Z" },
    },
    {
      name: "doc/v0002",
      commit: { sha: "bbb", created: "2026-03-10T00:00:00Z" },
    },
    {
      name: "unrelated-tag",
      commit: { sha: "ddd", created: "2026-03-15T00:00:00Z" },
    },
  ];

  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/tags": () => tags },
  });

  const { getLatestDocTag } = await import("./repos");
  const result = await getLatestDocTag(client, "alice", "quarterly-report");

  expect(result).not.toBeNull();
  expect(result?.version).toBe(3);
  expect(result?.sha).toBe("ccc");
  expect(result?.name).toBe("doc/v0003");
});

test("getLatestDocTag returns null when no doc tags exist", async () => {
  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/tags": () => [{ name: "v1.0.0" }] },
  });

  const { getLatestDocTag } = await import("./repos");
  const result = await getLatestDocTag(client, "alice", "quarterly-report");

  expect(result).toBeNull();
});

test("listDocTags returns sorted doc tags", async () => {
  const tags: Tag[] = [
    {
      name: "doc/v0002",
      commit: { sha: "bbb", created: "2026-03-10T00:00:00Z" },
    },
    {
      name: "doc/v0001",
      commit: { sha: "aaa", created: "2026-03-01T00:00:00Z" },
    },
    {
      name: "doc/v0003",
      commit: { sha: "ccc", created: "2026-03-20T00:00:00Z" },
    },
  ];

  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/tags": () => tags },
  });

  const { listDocTags } = await import("./repos");
  const result = await listDocTags(client, "alice", "quarterly-report");

  expect(result).toHaveLength(3);
  expect(result[0]?.version).toBe(3);
  expect(result[1]?.version).toBe(2);
  expect(result[2]?.version).toBe(1);
});

test("parseDocTagVersion rejects invalid tag names", async () => {
  const tags: Tag[] = [
    { name: "doc/v0000", commit: { sha: "xxx" } },
    { name: "doc/vABCD", commit: { sha: "yyy" } },
    { name: "release/1.0", commit: { sha: "zzz" } },
  ];

  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/tags": () => tags },
  });

  const { listDocTags } = await import("./repos");
  const result = await listDocTags(client, "alice", "quarterly-report");

  expect(result).toHaveLength(0);
});

test("getRepoBranchProtection returns normalised protection for matching branch", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branch_protections": () => [
        {
          rule_name: "main",
          required_approvals: 1,
          enable_approvals_whitelist: false,
          approvals_whitelist_username: [],
          enable_merge_whitelist: false,
          merge_whitelist_usernames: [],
          block_on_rejected_reviews: true,
        },
      ],
    },
  });

  const { getRepoBranchProtection } = await import("./repos");
  const protection = await getRepoBranchProtection(
    client,
    "alice",
    "quarterly-report",
    "main",
  );

  expect(protection).not.toBeNull();
  expect(protection?.requiredApprovals).toBe(1);
  expect(protection?.enableApprovalsWhitelist).toBe(false);
  expect(protection?.blockOnRejectedReviews).toBe(true);
});

test("getRepoBranchProtection returns null when no rules exist", async () => {
  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/branch_protections": () => [] },
  });

  const { getRepoBranchProtection } = await import("./repos");
  const protection = await getRepoBranchProtection(
    client,
    "alice",
    "quarterly-report",
    "main",
  );

  expect(protection).toBeNull();
});

test("getRepoBranchProtection falls back to first rule when branch name has no exact match", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branch_protections": () => [
        {
          rule_name: "release/*",
          required_approvals: 2,
          enable_approvals_whitelist: true,
          approvals_whitelist_username: ["alice", "bob"],
          enable_merge_whitelist: true,
          merge_whitelist_usernames: ["alice"],
          block_on_rejected_reviews: false,
        },
      ],
    },
  });

  const { getRepoBranchProtection } = await import("./repos");
  const protection = await getRepoBranchProtection(
    client,
    "alice",
    "quarterly-report",
    "main",
  );

  expect(protection).not.toBeNull();
  expect(protection?.requiredApprovals).toBe(2);
  expect(protection?.approvalsWhitelistUsernames).toEqual(["alice", "bob"]);
  expect(protection?.mergeWhitelistUsernames).toEqual(["alice"]);
});

test("getRepoBranchProtection throws GiteaApiError on network failure", async () => {
  const mockGet = mock(async () => ({
    data: undefined,
    error: { message: "Network error" },
    response: new Response(null, { status: 500 }),
  }));
  const client = {
    GET: mockGet,
    POST: mock(),
    PUT: mock(),
    DELETE: mock(),
    use: mock(),
  } as unknown as GiteaClient;

  const { getRepoBranchProtection } = await import("./repos");
  const { GiteaApiError } = await import("./client");

  await expect(
    getRepoBranchProtection(client, "alice", "quarterly-report", "main"),
  ).rejects.toThrow(GiteaApiError);
});
