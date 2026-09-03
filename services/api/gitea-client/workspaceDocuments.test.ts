import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import {
  listDocumentVersions,
  listWorkspaceDocuments,
  nextVersionFrom,
  nextVersionTag,
  toDocumentEntry,
} from "./workspaceDocuments";

type Handler = (init?: any) => unknown;

/** A handler returning this answers 404, the way a real Gitea would. */
const NOT_FOUND = Symbol("not-found");

function createMockClient(handlers: { GET?: Record<string, Handler> }) {
  const notFound = () => ({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  });

  const mockGet = mock(async (path: string, init?: unknown) => {
    const handler = handlers.GET?.[path];
    if (!handler) return notFound();
    const data = await handler(init);
    if (data === NOT_FOUND) return notFound();
    return {
      data,
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return {
    client: {
      GET: mockGet,
      POST: mock(),
      PUT: mock(),
      PATCH: mock(),
      DELETE: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
  };
}

test("toDocumentEntry reads a blob as a document at a path", () => {
  expect(
    toDocumentEntry({
      path: "clinical/infection-control.pdf",
      type: "blob",
      size: 1024,
      sha: "abc123",
    }),
  ).toEqual({
    path: "clinical/infection-control.pdf",
    slugPath: "clinical/infection-control",
    name: "infection-control",
    folder: "clinical",
    size: 1024,
    sha: "abc123",
  });
});

test("toDocumentEntry treats a document at the binder root as folderless", () => {
  expect(toDocumentEntry({ path: "handover.md", type: "blob" })?.folder).toBe(
    "",
  );
  expect(toDocumentEntry({ path: "handover.md", type: "blob" })?.slugPath).toBe(
    "handover",
  );
});

test("toDocumentEntry keeps a file with no extension whole", () => {
  // `readme` is a document, not a broken one — the identity is the path.
  const entry = toDocumentEntry({ path: "readme", type: "blob" });
  expect(entry?.slugPath).toBe("readme");
  expect(entry?.name).toBe("readme");
});

test("toDocumentEntry ignores directories", () => {
  expect(toDocumentEntry({ path: "clinical", type: "tree" })).toBeNull();
});

test("toDocumentEntry ignores repository furniture", () => {
  // A binder is a repository, so it carries CODEOWNERS and whatever else lives
  // under `.gitea/`. Listing configuration as policy would put it in front of a
  // surveyor.
  expect(
    toDocumentEntry({ path: ".gitea/CODEOWNERS", type: "blob" }),
  ).toBeNull();
  expect(toDocumentEntry({ path: ".gitignore", type: "blob" })).toBeNull();
});

test("listWorkspaceDocuments walks the binder once and sorts by path", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [
          { path: "nursing", type: "tree" },
          { path: "nursing/handover.md", type: "blob", size: 10, sha: "b" },
          { path: "admissions.md", type: "blob", size: 20, sha: "a" },
          { path: ".gitea/CODEOWNERS", type: "blob", size: 5, sha: "c" },
        ],
      }),
    },
  });

  const documents = await listWorkspaceDocuments({
    client,
    org: "mercy-health",
    workspace: "clinical",
  });

  expect(documents.map((d) => d.slugPath)).toEqual([
    "admissions",
    "nursing/handover",
  ]);
});

test("listWorkspaceDocuments treats a binder with no commits as empty", async () => {
  // A workspace somebody just made has no tree yet. That is the ordinary first
  // state, not a failure.
  const { client } = createMockClient({
    GET: { "/repos/{owner}/{repo}/git/trees/{sha}": () => NOT_FOUND },
  });

  expect(
    await listWorkspaceDocuments({
      client,
      org: "mercy-health",
      workspace: "clinical",
    }),
  ).toEqual([]);
});

test("listDocumentVersions counts only this document's tags", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/tags": () => [
        { name: "nursing/handover/v1", commit: { sha: "aaa" } },
        { name: "nursing/handover/v2", commit: { sha: "bbb" } },
        // Another document in the same binder. Tags are repository-global,
        // which is exactly why the version has to carry the document.
        { name: "admissions/v9", commit: { sha: "ccc" } },
        // Not ours. Counting it would invent a version nobody published.
        { name: "release-2026", commit: { sha: "ddd" } },
      ],
    },
  });

  const versions = await listDocumentVersions({
    client,
    org: "mercy-health",
    workspace: "clinical",
    slugPath: "nursing/handover",
  });

  // Newest first.
  expect(versions).toEqual([
    { tag: "nursing/handover/v2", version: 2, commitSha: "bbb" },
    { tag: "nursing/handover/v1", version: 1, commitSha: "aaa" },
  ]);
});

test("the next version follows the highest published one", () => {
  expect(nextVersionFrom([])).toBe(1);
  expect(
    nextVersionFrom([
      { tag: "handover/v1", version: 1, commitSha: "a" },
      { tag: "handover/v4", version: 4, commitSha: "b" },
    ]),
  ).toBe(5);

  expect(nextVersionTag("nursing/handover", [])).toBe("nursing/handover/v1");
});
