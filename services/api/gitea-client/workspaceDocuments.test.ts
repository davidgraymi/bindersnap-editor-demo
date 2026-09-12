import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import {
  createDocumentVersionTag,
  findWorkspaceDocument,
  listChangedDocuments,
  listDocumentVersions,
  listVersionsByDocument,
  listWorkspaceDocuments,
  readWorkspaceTree,
  nextVersionFrom,
  nextVersionTag,
  toDocumentEntry,
} from "./workspaceDocuments";

/** Real identities, so the tests exercise the validation the product does. */
const HANDOVER = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const ADMISSIONS = "01J9A0B1C2D3E4F5G6H7J8K9M0";
const OTHER_ABSENT = "01JB1C2D3E4F5G6H7J8K9MNPQR";

type Handler = (init?: any) => unknown;

/** A handler returning this answers 404, the way a real Gitea would. */
const NOT_FOUND = Symbol("not-found");

function createMockClient(handlers: {
  GET?: Record<string, Handler>;
  POST?: Record<string, Handler>;
}) {
  const notFound = () => ({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  });

  const method = (verb: "GET" | "POST") =>
    mock(async (path: string, init?: unknown) => {
      const handler = handlers[verb]?.[path];
      if (!handler) return notFound();
      const data = await handler(init);
      if (data === NOT_FOUND) return notFound();
      return {
        data,
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    });

  const mockGet = method("GET");
  const mockPost = method("POST");

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mock(),
      PATCH: mock(),
      DELETE: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
  };
}

test("toDocumentEntry reads a blob as a document at a path", () => {
  expect(
    toDocumentEntry({
      path: `clinical/infection-control.${HANDOVER}.pdf`,
      type: "blob",
      size: 1024,
      sha: "abc123",
    }),
  ).toEqual({
    path: `clinical/infection-control.${HANDOVER}.pdf`,
    // The address drops the identity and the extension: it is what a link
    // carries and what a heading says.
    slugPath: "clinical/infection-control",
    name: "infection-control",
    uid: HANDOVER,
    folder: "clinical",
    size: 1024,
    sha: "abc123",
  });
});

test("a document renamed keeps its identity and changes its address", () => {
  // ADR 0005 in one assertion. Under ADR 0004 these were the same document
  // becoming two, and the second one started again at v1.
  const before = toDocumentEntry({
    path: `nursing/hand-hygiene.${HANDOVER}.md`,
    type: "blob",
  });
  const after = toDocumentEntry({
    path: `infection-control/hand-hygiene-and-ppe.${HANDOVER}.md`,
    type: "blob",
  });

  expect(after?.slugPath).not.toBe(before?.slugPath);
  expect(after?.uid).toBe(before!.uid!);
});

test("toDocumentEntry describes a file this product did not write", () => {
  // Described, not hidden: it is a blob in a tree that has to be listed, and
  // the publish guard is where the refusal belongs.
  const entry = toDocumentEntry({ path: "nursing/NOTES.md", type: "blob" });
  expect(entry?.slugPath).toBe("nursing/NOTES");
  expect(entry?.uid).toBeNull();
});

test("toDocumentEntry treats a document at the binder root as folderless", () => {
  const path = `handover.${HANDOVER}.md`;
  expect(toDocumentEntry({ path, type: "blob" })?.folder).toBe("");
  expect(toDocumentEntry({ path, type: "blob" })?.slugPath).toBe("handover");
});

test("toDocumentEntry reads a document with no extension", () => {
  // The identity is a segment, so a filename that ends at it parses by the
  // same rule — the extension was never what identified anything.
  const entry = toDocumentEntry({
    path: `readme.${HANDOVER}`,
    type: "blob",
  });
  expect(entry?.slugPath).toBe("readme");
  expect(entry?.name).toBe("readme");
  expect(entry?.uid).toBe(HANDOVER);
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
          {
            path: `nursing/handover.${HANDOVER}.md`,
            type: "blob",
            size: 10,
            sha: "b",
          },
          {
            path: `admissions.${ADMISSIONS}.md`,
            type: "blob",
            size: 20,
            sha: "a",
          },
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
        { name: `${HANDOVER}/v1`, commit: { sha: "aaa" } },
        { name: `${HANDOVER}/v2`, commit: { sha: "bbb" } },
        // Another document in the same binder. Tags are repository-global,
        // which is exactly why the version has to carry the document.
        { name: `${ADMISSIONS}/v9`, commit: { sha: "ccc" } },
        // Not ours. Counting it would invent a version nobody published.
        { name: "release-2026", commit: { sha: "ddd" } },
        // The shape ADR 0004 wrote. Not a version of anything now, and
        // counting it would number this document after a path it had once.
        { name: "nursing/handover/v9", commit: { sha: "eee" } },
      ],
    },
  });

  const versions = await listDocumentVersions({
    client,
    org: "mercy-health",
    workspace: "clinical",
    uid: HANDOVER,
  });

  // Newest first.
  expect(versions).toEqual([
    { tag: `${HANDOVER}/v2`, version: 2, commitSha: "bbb", publishedAt: "" },
    { tag: `${HANDOVER}/v1`, version: 1, commitSha: "aaa", publishedAt: "" },
  ]);
});

test("a file with no identity has published nothing, and costs no call", async () => {
  const { client, mockGet } = createMockClient({ GET: {} });

  expect(
    await listDocumentVersions({
      client,
      org: "mercy-health",
      workspace: "clinical",
      uid: null,
    }),
  ).toEqual([]);
  expect(mockGet).not.toHaveBeenCalled();
});

test("listVersionsByDocument keys a binder's tags by address", async () => {
  // The tags are named after identities and every caller's rows are keyed on
  // the address. The tree is what joins them.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [
          { path: `nursing/handover.${HANDOVER}.md`, type: "blob" },
          { path: `admissions.${ADMISSIONS}.md`, type: "blob" },
        ],
      }),
      "/repos/{owner}/{repo}/tags": () => [
        { name: `${HANDOVER}/v1`, commit: { sha: "aaa" } },
        { name: `${HANDOVER}/v2`, commit: { sha: "bbb" } },
        { name: `${ADMISSIONS}/v9`, commit: { sha: "ccc" } },
      ],
    },
  });

  const byDocument = await listVersionsByDocument({
    client,
    org: "mercy-health",
    workspace: "clinical",
  });

  expect([...byDocument.keys()].sort()).toEqual([
    "admissions",
    "nursing/handover",
  ]);
  expect(byDocument.get("nursing/handover")?.map((v) => v.version)).toEqual([
    2, 1,
  ]);
});

test("a tag naming no document in the tree is left out", async () => {
  // It cannot happen through the product — nothing deletes a document and
  // nothing strips an identity — but it is what an ADR 0004 tag looks like
  // now, and what a binder edited directly in Gitea could produce.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [{ path: `nursing/handover.${HANDOVER}.md`, type: "blob" }],
      }),
      "/repos/{owner}/{repo}/tags": () => [
        { name: `${HANDOVER}/v1`, commit: { sha: "aaa" } },
        { name: `${ADMISSIONS}/v4`, commit: { sha: "bbb" } },
        { name: "nursing/handover/v3", commit: { sha: "ccc" } },
      ],
    },
  });

  const byDocument = await listVersionsByDocument({
    client,
    org: "mercy-health",
    workspace: "clinical",
  });

  expect([...byDocument.keys()]).toEqual(["nursing/handover"]);
  expect(byDocument.get("nursing/handover")?.map((v) => v.version)).toEqual([
    1,
  ]);
});

test("the next version follows the highest published one", () => {
  expect(nextVersionFrom([])).toBe(1);
  expect(
    nextVersionFrom([
      { tag: "handover/v1", version: 1, commitSha: "a", publishedAt: "" },
      { tag: "handover/v4", version: 4, commitSha: "b", publishedAt: "" },
    ]),
  ).toBe(5);

  expect(nextVersionTag(HANDOVER, [])).toBe(`${HANDOVER}/v1`);
});

test("listChangedDocuments answers with every document a change touched", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/pulls/{index}/files": () => [
        { filename: `nursing/handover.${HANDOVER}.md` },
        { filename: `admissions.${ADMISSIONS}.md` },
        // Repository furniture. A change that edits CODEOWNERS alongside two
        // policies publishes two versions, not three.
        { filename: ".gitea/CODEOWNERS" },
      ],
    },
  });

  const documents = await listChangedDocuments({
    client,
    org: "mercy-health",
    workspace: "clinical",
    pullNumber: 7,
  });

  // The unit of approval is the change, not the document (ADR 0004 §4), so
  // publishing has to know every document it covers.
  expect(documents.map((d) => d.slugPath)).toEqual([
    "admissions",
    "nursing/handover",
  ]);
});

test("listChangedDocuments counts a document once, however many times it changed", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/pulls/{index}/files": () => [
        { filename: `nursing/handover.${HANDOVER}.md` },
        { filename: `nursing/handover.${HANDOVER}.md` },
      ],
    },
  });

  expect(
    await listChangedDocuments({
      client,
      org: "mercy-health",
      workspace: "clinical",
      pullNumber: 7,
    }),
  ).toHaveLength(1);
});

test("a renamed document is one document, at its new address", async () => {
  // Gitea reports a rename as two entries carrying one identity. Publishing
  // both would compute the same next version twice and write one tag twice —
  // git refuses the second, and the publish half-succeeds.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/pulls/{index}/files": () => [
        {
          filename: `nursing/hand-hygiene.${HANDOVER}.md`,
          // Gitea's spelling, verified against a running one. GitHub says
          // "removed"; both are treated the same, because guessing wrong here
          // writes a version tag for a file that is not there.
          status: "deleted",
        },
        {
          filename: `nursing/hand-hygiene-and-ppe.${HANDOVER}.md`,
          status: "added",
        },
      ],
    },
  });

  const documents = await listChangedDocuments({
    client,
    org: "mercy-health",
    workspace: "clinical",
    pullNumber: 7,
  });

  expect(documents).toHaveLength(1);
  expect(documents[0]?.slugPath).toBe("nursing/hand-hygiene-and-ppe");
  expect(documents[0]?.uid).toBe(HANDOVER);
});

test("a document a change only deletes publishes nothing", async () => {
  // Tagging it would name a version after a path that is not in the tree.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/pulls/{index}/files": () => [
        { filename: `nursing/handover.${HANDOVER}.md`, status: "removed" },
        { filename: `nursing/old.${OTHER_ABSENT}.md`, status: "deleted" },
        { filename: `admissions.${ADMISSIONS}.md`, status: "modified" },
      ],
    },
  });

  const documents = await listChangedDocuments({
    client,
    org: "mercy-health",
    workspace: "clinical",
    pullNumber: 7,
  });

  expect(documents.map((d) => d.slugPath)).toEqual(["admissions"]);
});

test("createDocumentVersionTag names the document in the tag", async () => {
  let body: Record<string, unknown> = {};
  const { client } = createMockClient({
    POST: {
      "/repos/{owner}/{repo}/tags": (init: {
        body: Record<string, unknown>;
      }) => {
        body = init.body;
        return { commit: { sha: "merge-sha" } };
      },
    },
  });

  const version = await createDocumentVersionTag({
    client,
    org: "mercy-health",
    workspace: "clinical",
    uid: HANDOVER,
    slugPath: "nursing/handover",
    version: 2,
    target: "main",
  });

  // Tags are repository-global and a binder holds many documents, so the
  // version has to carry the document with it — and it carries the identity
  // rather than the path, so a rename does not restart the numbering.
  expect(body.tag_name).toBe(`${HANDOVER}/v2`);
  expect(body.target).toBe("main");
  expect(version).toEqual({
    tag: `${HANDOVER}/v2`,
    version: 2,
    commitSha: "merge-sha",
    publishedAt: "",
  });
});

test("two documents differing only by extension share one identity", () => {
  // The reason uploads refuse this. A URL has to name one thing, and the
  // identity deliberately drops the extension so that re-uploading a policy as
  // a PDF keeps its history — which only works if nothing else can claim the
  // same identity.
  const markdown = toDocumentEntry({ path: "nursing/policy.md", type: "blob" });
  const pdf = toDocumentEntry({ path: "nursing/policy.pdf", type: "blob" });

  expect(markdown?.slugPath).toBe("nursing/policy");
  expect(pdf?.slugPath).toBe("nursing/policy");
});

test("an exact file path wins over an address match", async () => {
  // So a link carrying the extension always resolves to that exact file, even
  // in a binder edited outside Bindersnap that already holds a collision.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [
          {
            path: `nursing/policy.${ADMISSIONS}.pdf`,
            type: "blob",
            sha: "pdf",
          },
          { path: `nursing/policy.${HANDOVER}.md`, type: "blob", sha: "md" },
        ],
      }),
    },
  });

  const exact = await findWorkspaceDocument({
    client,
    org: "riverside-health",
    workspace: "clinical",
    documentPath: `nursing/policy.${HANDOVER}.md`,
  });
  expect(exact?.sha).toBe("md");

  // And an address-only link resolves the same way every time rather than
  // alphabetically by accident.
  const byIdentity = await findWorkspaceDocument({
    client,
    org: "riverside-health",
    workspace: "clinical",
    documentPath: "nursing/policy",
  });
  expect(byIdentity).not.toBeNull();
  expect(byIdentity?.slugPath).toBe("nursing/policy");
});

test("the tree answers with folders, including the empty ones", async () => {
  // **Git has no empty directories**, so a folder somebody made and has not
  // filed anything in yet exists because a placeholder is sitting in it — and
  // that file is furniture, filtered out of the documents. Deriving folders
  // from document paths, which is what this replaced, made a folder appear
  // only once it stopped being empty.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [
          { path: "nursing", type: "tree" },
          { path: `nursing/handover.${HANDOVER}.md`, type: "blob" },
          { path: "ward-3", type: "tree" },
          { path: "ward-3/.gitkeep", type: "blob" },
          { path: ".gitea", type: "tree" },
          { path: ".gitea/CODEOWNERS", type: "blob" },
        ],
      }),
    },
  });

  const tree = await readWorkspaceTree({
    client,
    org: "mercy-health",
    workspace: "clinical",
  });

  expect(tree.folders).toEqual(["nursing", "ward-3"]);
  expect(tree.documents.map((d) => d.slugPath)).toEqual(["nursing/handover"]);
  // Every blob, furniture included — a rename has to move a placeholder, and a
  // collision check has to know it is there. Reconstructing this list from the
  // two above named a placeholder in folders that never had one, and Gitea
  // refused to move a file that was not there.
  expect(tree.paths).toEqual([
    `nursing/handover.${HANDOVER}.md`,
    "ward-3/.gitkeep",
  ]);
});

test("the binder's own configuration is not part of its shape", async () => {
  // `.gitea/` holds the sign-off rules. Renaming a folder must never sweep it
  // along, so it is not in the paths a rename operates over.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/git/trees/{sha}": () => ({
        tree: [{ path: ".gitea/CODEOWNERS", type: "blob" }],
      }),
    },
  });

  const tree = await readWorkspaceTree({
    client,
    org: "mercy-health",
    workspace: "clinical",
  });
  expect(tree.paths).toEqual([]);
  expect(tree.folders).toEqual([]);
});
