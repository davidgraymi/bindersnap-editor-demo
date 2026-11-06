import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import { commitDraftSave, findFoldableSave } from "./binderFiles";

const NOW = new Date("2026-11-05T12:00:00Z");
const PATH = "hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.json";
const SUBJECT = "Edit Hand Hygiene";

/** The commit message an editor save writes, trailers and all. */
function saveMessage(by = "alice", path = PATH, subject = SUBJECT): string {
  return [
    subject,
    "",
    `Bindersnap-Canonical-File: ${path}`,
    `Bindersnap-Uploaded-By: ${by}`,
  ].join("\n");
}

/** The draft's newest commit not on `main`, as Gitea lists it. */
function tip(over: Record<string, unknown> = {}) {
  return {
    sha: "tip",
    parents: [{ sha: "parent" }],
    files: [{ filename: PATH }],
    commit: {
      message: saveMessage(),
      author: { date: "2026-11-05T11:50:00Z" },
      committer: { date: "2026-11-05T11:58:00Z" },
    },
    ...over,
  };
}

function ok(data: unknown, status = 200) {
  return { data, error: undefined, response: new Response(null, { status }) };
}

/**
 * A Gitea that answers the commits list with `rows`, and records every write.
 * `moveStatus` is what moving the draft answers: 422 when it moved meanwhile.
 */
function createClient(rows: unknown[], moveStatus = 204) {
  const calls: string[] = [];
  const client = {
    GET: mock(async (path: string, init: any) => {
      calls.push(`GET ${path} ${JSON.stringify(init?.params?.query ?? {})}`);
      return ok(rows);
    }),
    POST: mock(async (path: string, init: any) => {
      calls.push(`POST ${path} ${JSON.stringify(init?.body ?? {})}`);
      if (path === "/repos/{owner}/{repo}/contents") {
        return ok({ commit: { sha: "folded" } }, 201);
      }
      return ok({}, 201);
    }),
    PUT: mock(async (path: string, init: any) => {
      calls.push(`PUT ${path} ${JSON.stringify(init?.body ?? {})}`);
      return {
        data: undefined,
        error: moveStatus < 300 ? undefined : { message: "moved" },
        response: new Response(null, { status: moveStatus }),
      };
    }),
    DELETE: mock(async (path: string, init: any) => {
      calls.push(`DELETE ${init?.params?.path?.branch}`);
      return ok(undefined, 204);
    }),
  } as unknown as GiteaClient;
  return { client, calls };
}

const find = (client: GiteaClient) =>
  findFoldableSave({
    client,
    org: "riverside",
    workspace: "clinical",
    branch: "draft/alice/1",
    subject: SUBJECT,
    path: PATH,
    username: "alice",
    now: NOW,
  });

test("a save folds into the last save of the same document by the same person", async () => {
  const { client, calls } = createClient([tip()]);
  expect(await find(client)).toEqual({
    sha: "tip",
    parent: "parent",
    startedAt: "2026-11-05T11:50:00Z",
  });
  // Only the draft's own commits are candidates: never one on `main`.
  expect(calls[0]).toContain('"not":"main"');
  expect(calls[0]).toContain('"limit":1');
});

test("nothing folds into a commit that is not that same save", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "another document",
      { files: [{ filename: "other.01J8XZ4K7MQ9V3B0RN7YHS2E1E.json" }] },
    ],
    [
      "more than one file",
      { files: [{ filename: PATH }, { filename: "x.json" }] },
    ],
    ["a merge", { parents: [{ sha: "a" }, { sha: "b" }] }],
    [
      "another act",
      {
        commit: {
          message: saveMessage("alice", PATH, "Rename Hand Hygiene"),
          author: { date: "2026-11-05T11:50:00Z" },
        },
      },
    ],
    [
      "another person",
      {
        commit: {
          message: saveMessage("bob"),
          author: { date: "2026-11-05T11:50:00Z" },
        },
      },
    ],
    [
      // Saved into a minute ago, but begun more than an hour ago: an hour's
      // checkpoint is kept.
      "begun an hour ago",
      {
        commit: {
          message: saveMessage(),
          author: { date: "2026-11-05T10:59:00Z" },
          committer: { date: "2026-11-05T11:59:00Z" },
        },
      },
    ],
  ];
  for (const [why, over] of cases) {
    const { client } = createClient([tip(over)]);
    expect({ why, foldable: await find(client) }).toEqual({
      why,
      foldable: null,
    });
  }
});

test("a draft with no commits of its own has nothing to fold into", async () => {
  const { client } = createClient([]);
  expect(await find(client)).toBeNull();
});

const save = (client: GiteaClient) =>
  commitDraftSave({
    client,
    org: "riverside",
    workspace: "clinical",
    branch: "draft/alice/1",
    operations: [{ kind: "write", path: PATH, base64Content: "e30=" }],
    message: saveMessage(),
    username: "alice",
    now: NOW,
  });

test("folding commits beside the last save and moves the draft only from where it was read", async () => {
  const { client, calls } = createClient([tip()]);
  expect(await save(client)).toEqual({ folded: true });

  const scratch = calls.find((call) =>
    call.startsWith("POST /repos/{owner}/{repo}/branches"),
  )!;
  // A scratch branch at the last save's parent, never under `draft/`.
  expect(scratch).toContain('"old_ref_name":"parent"');
  expect(scratch).toMatch(/"new_branch_name":"fold\/alice\//);
  // Dated from the first save it holds, so the hour counts from there.
  const written = calls.find((call) =>
    call.startsWith("POST /repos/{owner}/{repo}/contents"),
  )!;
  expect(written).toContain('"author":"2026-11-05T11:50:00Z"');
  const move = calls.find((call) => call.startsWith("PUT "))!;
  expect(move).toContain('"new_commit_id":"folded"');
  expect(move).toContain('"old_commit_id":"tip"');
  // The scratch branch is gone afterwards.
  expect(calls.at(-1)).toMatch(/^DELETE fold\/alice\//);
});

test("a draft that moved meanwhile gets the save as an ordinary commit", async () => {
  const { client, calls } = createClient([tip()], 422);
  expect(await save(client)).toEqual({ folded: false });
  const contents = calls.filter((call) =>
    call.startsWith("POST /repos/{owner}/{repo}/contents"),
  );
  // The scratch commit, then the save itself on top of the draft.
  expect(contents).toHaveLength(2);
  expect(contents[1]).toContain('"branch":"draft/alice/1"');
  expect(calls.some((call) => call.startsWith("DELETE fold/alice/"))).toBe(
    true,
  );
});

test("a save with nothing to fold into is an ordinary commit", async () => {
  const { client, calls } = createClient([]);
  expect(await save(client)).toEqual({ folded: false });
  expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
  expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
});
