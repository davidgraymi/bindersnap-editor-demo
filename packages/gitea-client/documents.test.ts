import { expect, mock, test } from "bun:test";
import type { GiteaClient } from "./client";

function createMockClient(handlers: {
  GET?: Record<string, (...args: any[]) => unknown>;
  POST?: Record<string, (...args: any[]) => unknown>;
  PUT?: Record<string, (...args: any[]) => unknown>;
}) {
  const mockGet = mock(async (path: string, init?: unknown) => {
    const handler = handlers.GET?.[path];
    if (handler) {
      const data = await handler(init);
      return { data, error: undefined, response: new Response(null, { status: 200 }) };
    }
    return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
  });

  const mockPost = mock(async (path: string, init?: unknown) => {
    const handler = handlers.POST?.[path];
    if (handler) {
      const data = await handler(init);
      return { data, error: undefined, response: new Response(null, { status: 200 }) };
    }
    return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
  });

  const mockPut = mock(async (path: string, init?: unknown) => {
    const handler = handlers.PUT?.[path];
    if (handler) {
      const data = await handler(init);
      return { data, error: undefined, response: new Response(null, { status: 200 }) };
    }
    return { data: undefined, error: { message: "not found" }, response: new Response(null, { status: 404 }) };
  });

  return {
    client: { GET: mockGet, POST: mockPost, PUT: mockPut, DELETE: mock(), use: mock() } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
  };
}

const defaultCommits = [
  {
    sha: "commit-1",
    commit: { message: "seed: add draft document", author: { name: "Alice Admin", date: "2026-03-30T11:00:00Z" } },
  },
  {
    sha: "commit-2",
    commit: { message: "seed: update draft document", author: { name: "Bob Reviewer", date: "2026-03-30T12:00:00Z" } },
  },
];

test("commitDocument creates a file when sha is absent", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({
        commit: { sha: "create-sha" },
        content: { sha: "file-create-sha" },
      }),
    },
  });

  const { commitDocument } = await import("./documents");

  const result = await commitDocument({
    client,
    owner: "alice",
    repo: "quarterly-report",
    filePath: "documents/draft.json",
    branch: "main",
    message: "seed: add draft document",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    },
  });

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    sha: "create-sha",
    fileSha: "file-create-sha",
  });
});

test("commitDocument updates a file when sha is present", async () => {
  const { client, mockPut } = createMockClient({
    PUT: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({
        commit: { sha: "update-sha" },
        content: { sha: "file-update-sha" },
      }),
    },
  });

  const { commitDocument } = await import("./documents");

  const result = await commitDocument({
    client,
    owner: "alice",
    repo: "quarterly-report",
    filePath: "documents/draft.json",
    branch: "main",
    sha: "current-sha",
    message: "seed: update draft document",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }],
    },
  });

  expect(mockPut).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    sha: "update-sha",
    fileSha: "file-update-sha",
  });
});

test("fetchDocumentAtSha returns parsed ProseMirror JSON", async () => {
  const docJson = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });

  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/raw/{filepath}": () => docJson,
    },
  });

  // Override GET to return text parseAs response shape
  (client as any).GET = mock(async () => ({
    data: docJson,
    error: undefined,
    response: new Response(null, { status: 200 }),
  }));

  const { fetchDocumentAtSha } = await import("./documents");

  const doc = await fetchDocumentAtSha({
    client,
    owner: "alice",
    repo: "quarterly-report",
    filePath: "documents/draft.json",
    sha: "commit-1",
  });

  expect(doc).toEqual({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });
});

test("fetchDocumentAtSha surfaces invalid JSON as GiteaApiError", async () => {
  const { client } = createMockClient({});
  (client as any).GET = mock(async () => ({
    data: "not-json{{{",
    error: undefined,
    response: new Response(null, { status: 200 }),
  }));

  const { fetchDocumentAtSha } = await import("./documents");

  await expect(
    fetchDocumentAtSha({
      client,
      owner: "alice",
      repo: "quarterly-report",
      filePath: "documents/draft.json",
      sha: "commit-1",
    }),
  ).rejects.toMatchObject({
    name: "GiteaApiError",
    message: "Unable to parse document JSON at documents/draft.json.",
  });
});

test("listDocumentCommits maps commit summaries", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/commits": () => defaultCommits,
    },
  });

  const { listDocumentCommits } = await import("./documents");

  const commits = await listDocumentCommits({
    client,
    owner: "alice",
    repo: "quarterly-report",
    filePath: "documents/draft.json",
    page: 1,
    limit: 10,
  });

  expect(commits).toEqual([
    {
      sha: "commit-1",
      message: "seed: add draft document",
      author: "Alice Admin",
      timestamp: "2026-03-30T11:00:00Z",
    },
    {
      sha: "commit-2",
      message: "seed: update draft document",
      author: "Bob Reviewer",
      timestamp: "2026-03-30T12:00:00Z",
    },
  ]);
});

test("listDocumentCommits maps API failures to GiteaApiError", async () => {
  const { client } = createMockClient({});
  // Override GET to return an error
  (client as any).GET = mock(async () => ({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  }));

  const { listDocumentCommits } = await import("./documents");

  await expect(
    listDocumentCommits({
      client,
      owner: "alice",
      repo: "quarterly-report",
      filePath: "documents/missing.json",
    }),
  ).rejects.toMatchObject({
    name: "GiteaApiError",
    status: 404,
    message: "not found",
  });
});
