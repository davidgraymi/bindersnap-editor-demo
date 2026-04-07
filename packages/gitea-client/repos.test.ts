import { expect, test } from "bun:test";
import { mock } from "bun:test";
import type { components } from "./spec/gitea";
import type { GiteaClient } from "./client";

// Use partial types for test fixtures — generated types require many fields
type Repository = Partial<Omit<components["schemas"]["Repository"], "owner">> & {
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

  const mockPost = mock(async (path: string, init?: { params?: unknown; body?: unknown }) => {
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
  });

  const mockDelete = mock(async (path: string, init?: { params?: unknown; body?: unknown }) => {
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
  });

  const mockPut = mock(async (path: string, init?: { params?: unknown; body?: unknown }) => {
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
  });

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

test("listWorkspaceRepos normalizes repository data", async () => {
  const repos: Repository[] = [
    {
      id: 1,
      name: "quarterly-report",
      full_name: "alice/quarterly-report",
      description: "Q2 report",
      updated_at: "2026-03-30T12:00:00Z",
      owner: { login: "alice" },
    },
    {
      id: 2,
      name: "vendor-docs",
      full_name: "alice/vendor-docs",
      description: "",
      updated_at: "2026-03-29T12:00:00Z",
      owner: { login: "alice" },
    },
  ];

  const { client } = createMockClient({
    GET: {
      "/repos/search": () => ({ data: repos }),
    },
  });

  const { listWorkspaceRepos } = await import("./repos");
  const result = await listWorkspaceRepos(client);

  expect(result).toHaveLength(2);
  expect(result[0]?.name).toBe("quarterly-report");
  expect(result[0]?.owner.login).toBe("alice");
  expect(result[1]?.name).toBe("vendor-docs");
});

test("listWorkspaceRepos handles empty response", async () => {
  const { client } = createMockClient({
    GET: { "/repos/search": () => ({ data: [] }) },
  });

  const { listWorkspaceRepos } = await import("./repos");
  const result = await listWorkspaceRepos(client);

  expect(result).toHaveLength(0);
});

test("createPrivateCurrentUserRepo creates a private initialized repo on main", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/user/repos": (init: { body?: { name?: string; private?: boolean; auto_init?: boolean; default_branch?: string } }) => ({
        id: 42,
        name: init?.body?.name,
        full_name: `alice/${init?.body?.name ?? ""}`,
        owner: { login: "alice" },
      }),
    },
  });

  const { createPrivateCurrentUserRepo } = await import("./repos");
  const repo = await createPrivateCurrentUserRepo({
    client,
    name: "quarterly-report",
    description: "Q2 report",
  });

  expect(mockPost).toHaveBeenCalled();
  expect(repo.name).toBe("quarterly-report");
  expect(repo.owner?.login).toBe("alice");

  const calls = mockPost.mock.calls as Array<[string, { body?: { name?: string; private?: boolean; auto_init?: boolean; default_branch?: string; description?: string } }]>;
  expect(calls[0]?.[1]?.body).toMatchObject({
    name: "quarterly-report",
    description: "Q2 report",
    private: true,
    auto_init: true,
    default_branch: "main",
  });
});

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
      "/repos/{owner}/{repo}/collaborators/{collaborator}/permission": (
        init: { params?: { path?: { collaborator?: string } } },
      ) => ({
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

test("addRepoCollaborator sends the requested permission level", async () => {
  const { client, mockPut } = createMockClient({
    PUT: {
      "/repos/{owner}/{repo}/collaborators/{collaborator}": (init: {
        body?: { permission?: string };
      }) => ({
        permission: init?.body?.permission,
      }),
    },
  });

  const { addRepoCollaborator } = await import("./repos");
  await addRepoCollaborator({
    client,
    owner: "alice",
    repo: "quarterly-report",
    collaborator: "bob",
    permission: "write",
  });

  expect(mockPut).toHaveBeenCalled();
  const calls = mockPut.mock.calls as Array<[
    string,
    { body?: { permission?: string } },
  ]>;
  expect(calls[0]?.[0]).toBe("/repos/{owner}/{repo}/collaborators/{collaborator}");
  expect(calls[0]?.[1]?.body).toMatchObject({ permission: "write" });
});

test("searchUsers returns normalized user results for typeahead", async () => {
  const { client } = createMockClient({
    GET: {
      "/users/search": (init: { params?: { query?: { q?: string; page?: number; limit?: number } } }) => ({
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

test("repoExists returns false for missing repos and true for existing repos", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}": () => ({
        id: 7,
        name: "quarterly-report",
        full_name: "alice/quarterly-report",
        owner: { login: "alice" },
      }),
    },
  });

  const missingClient = createMockClient({});

  const { repoExists } = await import("./repos");
  await expect(repoExists(client, "alice", "quarterly-report")).resolves.toBe(true);
  await expect(repoExists(missingClient.client, "alice", "missing")).resolves.toBe(false);
});

test("createMainBranchProtection creates a main rule with required approvals", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/branch_protections": (init: { body?: { rule_name?: string; required_approvals?: number } }) => ({
        rule_name: init?.body?.rule_name,
        required_approvals: init?.body?.required_approvals,
      }),
    },
  });

  const { createMainBranchProtection } = await import("./repos");
  const protection = await createMainBranchProtection({
    client,
    owner: "alice",
    repo: "quarterly-report",
    requiredApprovals: 2,
  });

  expect(mockPost).toHaveBeenCalled();
  expect(protection.requiredApprovals).toBe(2);

  const calls = mockPost.mock.calls as Array<[string, { body?: { rule_name?: string; required_approvals?: number; enable_approvals_whitelist?: boolean; enable_merge_whitelist?: boolean; block_on_rejected_reviews?: boolean } }]>;
  expect(calls[0]?.[1]?.body).toMatchObject({
    rule_name: "main",
    required_approvals: 2,
    enable_approvals_whitelist: false,
    enable_merge_whitelist: false,
    block_on_rejected_reviews: true,
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
  const calls = mockDelete.mock.calls as Array<[string, { body?: { branch?: string; sha?: string; message?: string } }]>;
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

test("createDocTag creates a tag with zero-padded version name", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/tags": (init: { body?: { tag_name?: string; target?: string; message?: string } }) => ({
        name: init?.body?.tag_name,
        commit: { sha: "newsha123", created: "2026-04-02T10:00:00Z" },
      }),
    },
  });

  const { createDocTag } = await import("./repos");
  const tag = await createDocTag({ client, owner: "alice", repo: "quarterly-report", version: 4, target: "main" });

  expect(mockPost).toHaveBeenCalled();
  expect(tag.name).toBe("doc/v0004");
  expect(tag.version).toBe(4);
  expect(tag.sha).toBe("newsha123");
});

test("createDocTag zero-pads version numbers with fewer than 4 digits", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/tags": (init: { body?: { tag_name?: string } }) => ({
        name: init?.body?.tag_name,
        commit: { sha: "abc", created: "2026-04-02T10:00:00Z" },
      }),
    },
  });

  const { createDocTag } = await import("./repos");
  await createDocTag({ client, owner: "alice", repo: "quarterly-report", version: 1, target: "abc123" });

  const calls = mockPost.mock.calls as Array<[string, { body?: { tag_name?: string } }]>;
  expect(calls[0]?.[1]?.body?.tag_name).toBe("doc/v0001");
});

test("createDocTag throws GiteaApiError on network failure", async () => {
  const mockPost = mock(async () => ({
    data: undefined,
    error: { message: "Network error" },
    response: new Response(null, { status: 500 }),
  }));
  const client = { GET: mock(), POST: mockPost, PUT: mock(), DELETE: mock(), use: mock() } as unknown as GiteaClient;

  const { createDocTag } = await import("./repos");
  const { GiteaApiError } = await import("./client");

  await expect(
    createDocTag({ client, owner: "alice", repo: "quarterly-report", version: 2, target: "main" }),
  ).rejects.toThrow(GiteaApiError);
});

test("createDocTag throws GiteaApiError when tag name does not match doc/v* pattern", async () => {
  const { client } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/tags": () => ({
        name: "invalid-tag",
        commit: { sha: "abc", created: "2026-04-02T10:00:00Z" },
      }),
    },
  });

  const { createDocTag } = await import("./repos");
  const { GiteaApiError } = await import("./client");

  await expect(
    createDocTag({ client, owner: "alice", repo: "quarterly-report", version: 3, target: "main" }),
  ).rejects.toThrow(GiteaApiError);
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
  const protection = await getRepoBranchProtection(client, "alice", "quarterly-report", "main");

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
  const protection = await getRepoBranchProtection(client, "alice", "quarterly-report", "main");

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
  const protection = await getRepoBranchProtection(client, "alice", "quarterly-report", "main");

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
  const client = { GET: mockGet, POST: mock(), PUT: mock(), DELETE: mock(), use: mock() } as unknown as GiteaClient;

  const { getRepoBranchProtection } = await import("./repos");
  const { GiteaApiError } = await import("./client");

  await expect(
    getRepoBranchProtection(client, "alice", "quarterly-report", "main"),
  ).rejects.toThrow(GiteaApiError);
});
