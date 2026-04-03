import { expect, test } from "bun:test";
import { mock } from "bun:test";
import type { components } from "./generated/gitea";
import type { GiteaClient } from "./client";

// Use partial types for test fixtures — generated types require many fields
type Repository = Partial<components["schemas"]["Repository"]> & { owner?: Partial<components["schemas"]["User"]> };
type Tag = Partial<components["schemas"]["Tag"]>;

function createMockClient(handlers: {
  GET?: Record<string, (...args: any[]) => unknown>;
}) {
  const mockGet = mock(async (path: string, init?: unknown) => {
    const handler = handlers.GET?.[path];
    if (handler) {
      const data = await handler(init);
      return { data, error: undefined, response: new Response(null, { status: 200 }) };
    }
    return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
  });

  return {
    client: { GET: mockGet, POST: mock(), PUT: mock(), DELETE: mock(), use: mock() } as unknown as GiteaClient,
    mockGet,
  };
}

test("listWorkspaceRepos normalizes repository data", async () => {
  const repos: Repository[] = [
    { id: 1, name: "quarterly-report", full_name: "alice/quarterly-report", description: "Q2 report", updated_at: "2026-03-30T12:00:00Z", owner: { login: "alice" } },
    { id: 2, name: "vendor-docs", full_name: "alice/vendor-docs", description: "", updated_at: "2026-03-29T12:00:00Z", owner: { login: "alice" } },
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

test("getLatestDocTag returns the highest version tag", async () => {
  const tags: Tag[] = [
    { name: "doc/v0001", commit: { sha: "aaa", created: "2026-03-01T00:00:00Z" } },
    { name: "doc/v0003", commit: { sha: "ccc", created: "2026-03-20T00:00:00Z" } },
    { name: "doc/v0002", commit: { sha: "bbb", created: "2026-03-10T00:00:00Z" } },
    { name: "unrelated-tag", commit: { sha: "ddd", created: "2026-03-15T00:00:00Z" } },
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
    { name: "doc/v0002", commit: { sha: "bbb", created: "2026-03-10T00:00:00Z" } },
    { name: "doc/v0001", commit: { sha: "aaa", created: "2026-03-01T00:00:00Z" } },
    { name: "doc/v0003", commit: { sha: "ccc", created: "2026-03-20T00:00:00Z" } },
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
