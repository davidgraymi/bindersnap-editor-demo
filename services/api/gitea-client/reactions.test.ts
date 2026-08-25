import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import { GiteaApiError } from "./client";
import type { components } from "./spec/gitea";
import {
  isSupportedReaction,
  listCommentReactions,
  REACTION_KINDS,
  setCommentReaction,
  summarizeReactions,
} from "./reactions";

type RawReaction = components["schemas"]["Reaction"];

const REACTIONS_PATH = "/repos/{owner}/{repo}/issues/comments/{id}/reactions";

function reaction(content: string, login: string): RawReaction {
  return {
    content,
    created_at: "2026-08-24T10:00:00Z",
    user: { login, full_name: login.toUpperCase() } as RawReaction["user"],
  };
}

/** Mock client backed by a per-comment reaction store. */
function createMockClient(store: Record<number, RawReaction[]>) {
  const GET = mock(async (path: string, init?: any) => {
    if (path === REACTIONS_PATH) {
      const id = init?.params?.path?.id as number;
      const found = store[id];
      if (!found) {
        return {
          data: undefined,
          error: { message: "not found" },
          response: new Response(null, { status: 404 }),
        };
      }
      return {
        data: found,
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

  const POST = mock(async (_path: string, init?: any) => {
    const id = init?.params?.path?.id as number;
    (store[id] ??= []).push(reaction(init?.body?.content ?? "", "carol"));
    return {
      data: { content: init?.body?.content },
      error: undefined,
      response: new Response(null, { status: 201 }),
    };
  });

  const DELETE = mock(async (_path: string, init?: any) => {
    const id = init?.params?.path?.id as number;
    store[id] = (store[id] ?? []).filter(
      (entry) => entry.content !== init?.body?.content,
    );
    return {
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    };
  });

  return {
    client: { GET, POST, DELETE } as unknown as GiteaClient,
    GET,
    POST,
    DELETE,
  };
}

test("counts one entry per reaction kind and names who left it", () => {
  const summary = summarizeReactions(
    [reaction("+1", "alice"), reaction("+1", "bob"), reaction("heart", "bob")],
    "bob",
  );

  expect(summary).toHaveLength(2);
  expect(summary[0]).toMatchObject({
    content: "+1",
    count: 2,
    viewerReacted: true,
  });
  expect(summary[0]?.users.map((user) => user.login)).toEqual(["alice", "bob"]);
  expect(summary[1]).toMatchObject({ content: "heart", count: 1 });
});

test("a reader who did not react is not in the count", () => {
  const summary = summarizeReactions([reaction("+1", "alice")], "bob");
  expect(summary[0]?.viewerReacted).toBe(false);
});

test("a signed-out reader still sees the count", () => {
  const summary = summarizeReactions([reaction("+1", "alice")], null);
  expect(summary[0]).toMatchObject({ count: 1, viewerReacted: false });
});

test("the same person twice is one reaction, not two", () => {
  const summary = summarizeReactions(
    [reaction("+1", "alice"), reaction("+1", "alice")],
    null,
  );
  expect(summary[0]?.count).toBe(1);
});

test("reactions outside the vocabulary are dropped, not rendered", () => {
  // Somebody can still add a rocket from the Gitea UI; this app has no control
  // that could take it back, so it does not draw a chip for it.
  const summary = summarizeReactions(
    [reaction("rocket", "alice"), reaction("+1", "alice")],
    null,
  );
  expect(summary.map((entry) => entry.content)).toEqual(["+1"]);
});

test("chips come back in vocabulary order, not in the order Gitea listed them", () => {
  const summary = summarizeReactions(
    [reaction("heart", "alice"), reaction("-1", "bob"), reaction("+1", "cara")],
    null,
  );
  expect(summary.map((entry) => entry.content)).toEqual(["+1", "-1", "heart"]);
});

test("every supported kind is one Gitea allows by default", () => {
  const giteaDefaults = [
    "+1",
    "-1",
    "laugh",
    "confused",
    "heart",
    "hooray",
    "rocket",
    "eyes",
  ];
  for (const kind of REACTION_KINDS) {
    expect(giteaDefaults).toContain(kind);
  }
  expect(isSupportedReaction("rocket")).toBe(false);
});

test("reads reactions for many comments and keys them by comment", async () => {
  const { client, GET } = createMockClient({
    7: [reaction("+1", "alice")],
    8: [reaction("eyes", "bob")],
  });

  const byComment = await listCommentReactions({
    client,
    owner: "acme",
    repo: "policy",
    commentIds: [7, 8, 7],
    viewerLogin: "bob",
  });

  expect(byComment.get(7)?.[0]?.content).toBe("+1");
  expect(byComment.get(8)?.[0]?.viewerReacted).toBe(true);
  // The duplicate id is read once.
  expect(GET).toHaveBeenCalledTimes(2);
});

test("a comment whose reactions cannot be read still loads, without any", async () => {
  const { client } = createMockClient({ 7: [reaction("+1", "alice")] });

  const byComment = await listCommentReactions({
    client,
    owner: "acme",
    repo: "policy",
    commentIds: [7, 404],
    viewerLogin: null,
  });

  expect(byComment.get(404)).toEqual([]);
  expect(byComment.get(7)).toHaveLength(1);
});

test("leaving a reaction posts it; taking it back deletes it", async () => {
  const store: Record<number, RawReaction[]> = { 7: [] };
  const { client, POST, DELETE } = createMockClient(store);

  await setCommentReaction({
    client,
    owner: "acme",
    repo: "policy",
    commentId: 7,
    content: "+1",
    on: true,
  });
  expect(POST).toHaveBeenCalledTimes(1);
  expect(store[7]).toHaveLength(1);

  await setCommentReaction({
    client,
    owner: "acme",
    repo: "policy",
    commentId: 7,
    content: "+1",
    on: false,
  });
  expect(DELETE).toHaveBeenCalledTimes(1);
  expect(store[7]).toHaveLength(0);
});

test("a reaction outside the vocabulary is refused before Gitea is called", async () => {
  const { client, POST } = createMockClient({ 7: [] });

  await expect(
    setCommentReaction({
      client,
      owner: "acme",
      repo: "policy",
      commentId: 7,
      content: "rocket",
      on: true,
    }),
  ).rejects.toBeInstanceOf(GiteaApiError);
  expect(POST).not.toHaveBeenCalled();
});
