import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import {
  buildDraftBranchName,
  draftOwner,
  findCurrentDraft,
  isDraftBranch,
  listBinderDrafts,
  openDraft,
  readDraftActs,
} from "./drafts";

type Handler = (init?: any) => unknown;

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
      return {
        data: await handler(init),
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

test("a draft branch is named for the person whose work it is", () => {
  const branch = buildDraftBranchName(
    "alice",
    new Date("2026-09-12T14:35:22Z"),
  );
  expect(branch).toBe("draft/alice/20260912143522");
  expect(draftOwner(branch)).toBe("alice");
  expect(isDraftBranch(branch)).toBe(true);
});

test("a branch that is not ours is left alone", () => {
  // Reading somebody else's branch as a draft would offer to delete it.
  for (const branch of [
    "main",
    "draft/alice",
    "draft//20260912143522",
    "feature/draft/alice/20260912143522",
    "upload/nursing/hand-hygiene/20260402/143522Z-alice-abc12345",
  ]) {
    expect(draftOwner(branch)).toBeNull();
    expect(isDraftBranch(branch)).toBe(false);
  }
});

test("a draft with a change request open on it is no longer a draft", async () => {
  // The whole point of the subtraction. A proposed draft belongs in the
  // changes list; offering "propose this" against it a second time would open
  // a second change request for the same branch.
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branches": () => [
        { name: "main", commit: { timestamp: "2026-09-01T00:00:00Z" } },
        {
          name: "draft/alice/20260912143522",
          commit: {
            timestamp: "2026-09-12T14:40:00Z",
            message: "Make the folder nursing\n\nmore",
          },
        },
        {
          name: "draft/alice/20260910090000",
          commit: {
            timestamp: "2026-09-10T09:00:00Z",
            message: "Add a policy",
          },
        },
      ],
      "/repos/{owner}/{repo}/pulls": () => [
        { number: 7, head: { ref: "draft/alice/20260910090000" } },
      ],
    },
  });

  const drafts = await listBinderDrafts({
    client,
    org: "riverside-health",
    workspace: "clinical",
  });

  expect(drafts).toEqual([
    {
      branch: "draft/alice/20260912143522",
      owner: "alice",
      updatedAt: "2026-09-12T14:40:00Z",
      // The subject alone: a list of drafts reads as a list of work.
      lastAct: "Make the folder nursing",
    },
  ]);
});

test("drafts are listed newest first, and can be narrowed to one person", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branches": () => [
        {
          name: "draft/bob/20260911000000",
          commit: { timestamp: "2026-09-11T00:00:00Z", message: "Bob's work" },
        },
        {
          name: "draft/alice/20260912143522",
          commit: {
            timestamp: "2026-09-12T14:35:22Z",
            message: "Alice's work",
          },
        },
      ],
      "/repos/{owner}/{repo}/pulls": () => [],
    },
  });

  const all = await listBinderDrafts({
    client,
    org: "o",
    workspace: "w",
  });
  expect(all.map((draft) => draft.owner)).toEqual(["alice", "bob"]);

  const mine = await listBinderDrafts({
    client,
    org: "o",
    workspace: "w",
    owner: "bob",
  });
  expect(mine.map((draft) => draft.branch)).toEqual([
    "draft/bob/20260911000000",
  ]);
});

test("pressing Edit twice resumes the draft rather than forking it", async () => {
  const { client, mockPost } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branches": () => [
        {
          name: "draft/alice/20260912143522",
          commit: {
            timestamp: "2026-09-12T14:35:22Z",
            message: "Add a policy",
          },
        },
      ],
      "/repos/{owner}/{repo}/pulls": () => [],
    },
  });

  const draft = await openDraft({
    client,
    org: "o",
    workspace: "w",
    username: "alice",
  });

  expect(draft.branch).toBe("draft/alice/20260912143522");
  // And no branch was made: a second press has to land you back in your work.
  expect(mockPost).not.toHaveBeenCalled();
});

test("a person with no draft gets one made from main", async () => {
  const { client, mockPost } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branches": () => [{ name: "main" }],
      "/repos/{owner}/{repo}/pulls": () => [],
    },
    POST: { "/repos/{owner}/{repo}/branches": () => ({}) },
  });

  const draft = await openDraft({
    client,
    org: "o",
    workspace: "w",
    username: "alice",
    now: new Date("2026-09-12T14:35:22Z"),
  });

  expect(draft).toEqual({
    branch: "draft/alice/20260912143522",
    owner: "alice",
    updatedAt: null,
    lastAct: null,
  });
  expect(mockPost.mock.calls[0]?.[1]).toMatchObject({
    body: {
      new_branch_name: "draft/alice/20260912143522",
      old_branch_name: "main",
    },
  });
});

test("nobody is working on a binder with no draft branches", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branches": () => [{ name: "main" }],
      "/repos/{owner}/{repo}/pulls": () => [],
    },
  });

  expect(
    await findCurrentDraft({
      client,
      org: "o",
      workspace: "w",
      owner: "alice",
    }),
  ).toBeNull();
});

test("what is on a draft is the commits main does not have", async () => {
  // `not=main` is what makes this the draft's own work rather than the
  // binder's whole history.
  const { client, mockGet } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/commits": () => [
        {
          sha: "b2",
          commit: {
            message: "Rename Hand Hygiene to Hand Hygiene and PPE",
            committer: { date: "2026-09-12T14:40:00Z" },
          },
          files: [{ filename: "nursing/hand-hygiene.01J.md" }],
        },
        {
          sha: "b1",
          commit: {
            message: "Make the folder nursing\n\nNothing is filed in it yet.",
            committer: { date: "2026-09-12T14:35:00Z" },
          },
          files: [{ filename: "nursing/.gitkeep" }],
        },
      ],
    },
  });

  const acts = await readDraftActs({
    client,
    org: "o",
    workspace: "w",
    branch: "draft/alice/20260912143522",
  });

  expect(acts.map((act) => act.summary)).toEqual([
    "Rename Hand Hygiene to Hand Hygiene and PPE",
    // The subject, not the body: the body explains, the subject is the act.
    "Make the folder nursing",
  ]);
  expect(acts[1]?.paths).toEqual(["nursing/.gitkeep"]);

  expect(mockGet.mock.calls[0]?.[1]).toMatchObject({
    params: {
      query: { sha: "draft/alice/20260912143522", not: "main" },
    },
  });
});

test("a draft made a second ago with nothing on it is empty, not broken", async () => {
  // Gitea answers 404 for a branch with no commits of its own.
  const { client } = createMockClient({});

  expect(
    await readDraftActs({
      client,
      org: "o",
      workspace: "w",
      branch: "draft/alice/20260912143522",
    }),
  ).toEqual([]);
});
