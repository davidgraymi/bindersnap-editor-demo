import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import type { components } from "./spec/gitea";
import {
  groupReactions,
  isReactionKind,
  listCommentReactions,
  setCommentReaction,
} from "./reactions";

/**
 * Reactions on a review thread.
 *
 * What has to hold: a reaction is one per person, the reader can tell which
 * chips are theirs, the order does not move under their cursor, and nothing a
 * Gitea instance holds gets dropped just because Bindersnap does not offer it.
 */

type RawReaction = components["schemas"]["Reaction"];

const REACTIONS_PATH = "/repos/{owner}/{repo}/issues/comments/{id}/reactions";

function reaction(content: string, login: string): RawReaction {
  return {
    content,
    created_at: "2026-01-02T00:00:00Z",
    user: { login, full_name: login, avatar_url: "" } as RawReaction["user"],
  };
}

function createMockClient(initial: RawReaction[] = []) {
  const store = [...initial];

  const GET = mock(async (path: string) => {
    if (path === REACTIONS_PATH) {
      return {
        data: [...store],
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

  const POST = mock(async () => ({
    data: reaction("+1", "carol"),
    error: undefined,
    response: new Response(null, { status: 201 }),
  }));

  // Gitea answers a reaction delete with an empty 204.
  const DELETE = mock(async () => ({
    data: undefined,
    error: undefined,
    response: new Response(null, { status: 204 }),
  }));

  return {
    client: {
      GET,
      POST,
      DELETE,
      PUT: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    GET,
    POST,
    DELETE,
  };
}

const base = { owner: "alice", repo: "contract", commentId: 12 };

// --- what can be left -----------------------------------------------------

test("the picker's six are reactions; anything else is not", () => {
  for (const kind of ["+1", "-1", "eyes", "heart", "hooray", "confused"]) {
    expect(isReactionKind(kind)).toBe(true);
  }
  expect(isReactionKind("rocket")).toBe(false);
  expect(isReactionKind("")).toBe(false);
});

// --- grouping -------------------------------------------------------------

test("people who left the same reaction are counted together", () => {
  const groups = groupReactions(
    [reaction("+1", "alice"), reaction("+1", "bob")],
    "carol",
  );

  expect(groups).toHaveLength(1);
  expect(groups[0]!.count).toBe(2);
  expect(groups[0]!.users).toEqual(["alice", "bob"]);
});

test("the reader is told which reaction is their own", () => {
  const groups = groupReactions(
    [reaction("+1", "alice"), reaction("eyes", "bob")],
    "Alice",
  );

  expect(groups.find((g) => g.content === "+1")!.reactedByViewer).toBe(true);
  expect(groups.find((g) => g.content === "eyes")!.reactedByViewer).toBe(false);
});

test("nobody is counted twice for one reaction", () => {
  const groups = groupReactions(
    [reaction("+1", "alice"), reaction("+1", "alice")],
    "",
  );

  expect(groups[0]!.count).toBe(1);
  expect(groups[0]!.users).toEqual(["alice"]);
});

test("a reaction Bindersnap does not offer is still shown", () => {
  const groups = groupReactions(
    [reaction("rocket", "alice"), reaction("+1", "bob")],
    "",
  );

  // Offered kinds first, in the picker's order; the rest after.
  expect(groups.map((g) => g.content)).toEqual(["+1", "rocket"]);
});

test("the order is fixed, so chips do not move as votes come in", () => {
  const groups = groupReactions(
    [
      reaction("confused", "alice"),
      reaction("+1", "bob"),
      reaction("+1", "carol"),
      reaction("eyes", "dana"),
    ],
    "",
  );

  expect(groups.map((g) => g.content)).toEqual(["+1", "eyes", "confused"]);
});

test("a reaction with no user or no content is not a reaction", () => {
  const groups = groupReactions(
    [
      { content: "+1", created_at: "", user: undefined },
      { content: "", created_at: "", user: { login: "alice" } } as RawReaction,
    ],
    "",
  );

  expect(groups).toEqual([]);
});

// --- reading --------------------------------------------------------------

test("reactions are read from the comment they hang on", async () => {
  const { client, GET } = createMockClient([reaction("heart", "alice")]);

  const groups = await listCommentReactions({
    client,
    ...base,
    viewer: "alice",
  });

  expect(GET.mock.calls[0]![0]).toBe(REACTIONS_PATH);
  expect((GET.mock.calls[0]![1] as any).params.path).toEqual({
    owner: "alice",
    repo: "contract",
    id: 12,
  });
  expect(groups).toEqual([
    {
      content: "heart",
      count: 1,
      users: ["alice"],
      reactedByViewer: true,
    },
  ]);
});

// --- writing --------------------------------------------------------------

test("leaving a reaction posts it", async () => {
  const { client, POST, DELETE } = createMockClient();

  await setCommentReaction({ client, ...base, content: "+1", reacted: true });

  expect(POST).toHaveBeenCalledTimes(1);
  expect(DELETE).not.toHaveBeenCalled();
  expect((POST.mock.calls[0]![1] as any).body).toEqual({ content: "+1" });
});

test("taking a reaction back deletes it, and the empty 204 is not an error", async () => {
  const { client, POST, DELETE } = createMockClient();

  await setCommentReaction({ client, ...base, content: "+1", reacted: false });

  expect(DELETE).toHaveBeenCalledTimes(1);
  expect(POST).not.toHaveBeenCalled();
  expect((DELETE.mock.calls[0]![1] as any).body).toEqual({ content: "+1" });
});

test("a reaction outside the picker is refused before it reaches Gitea", async () => {
  const { client, POST } = createMockClient();

  await expect(
    setCommentReaction({
      client,
      ...base,
      content: "<script>alert(1)</script>",
      reacted: true,
    }),
  ).rejects.toThrow("not a reaction you can leave here");

  expect(POST).not.toHaveBeenCalled();
});

test("Gitea refusing the reaction is reported, not swallowed", async () => {
  const { client } = createMockClient();
  (client as any).POST = mock(async () => ({
    data: undefined,
    error: { message: "Forbidden" },
    response: new Response(null, { status: 403 }),
  }));

  await expect(
    setCommentReaction({ client, ...base, content: "+1", reacted: true }),
  ).rejects.toThrow("Forbidden");
});
