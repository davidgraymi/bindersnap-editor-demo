import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import type { components } from "./spec/gitea";
import {
  buildThreads,
  createDiscussionThread,
  isValidThreadId,
  listDiscussions,
  parseMarker,
  replyToDiscussion,
  setDiscussionResolution,
  stripForgedMarkers,
  stripMarkers,
  summarizeThreads,
} from "./discussions";

const COMMENTS_PATH = "/repos/{owner}/{repo}/issues/{index}/comments";

type RawComment = components["schemas"]["Comment"];

function marker(kind: string, threadId: string, extra = ""): string {
  return `<!-- bindersnap:v1 kind=${kind} thread=${threadId}${extra ? ` ${extra}` : ""} -->`;
}

function comment(
  id: number,
  body: string,
  createdAt: string,
  login = "alice",
): RawComment {
  return {
    id,
    body,
    created_at: createdAt,
    updated_at: createdAt,
    html_url: `https://gitea.test/c/${id}`,
    user: {
      login,
      full_name: login,
      avatar_url: "",
    } as RawComment["user"],
  };
}

/** Mock client backed by a mutable comment list, so posts are observable. */
function createMockClient(initial: RawComment[]) {
  const store = [...initial];
  let nextId = Math.max(0, ...store.map((c) => c.id ?? 0)) + 1;

  const GET = mock(async (path: string) => {
    if (path === COMMENTS_PATH) {
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

  const POST = mock(async (path: string, init?: any) => {
    if (path === COMMENTS_PATH) {
      // A posted comment lands after everything already in the store — a
      // reply that sorted before the root would read as reopening the thread
      // it was answering.
      const created = comment(
        nextId++,
        init?.body?.body ?? "",
        `2026-01-02T00:00:${String(store.length).padStart(2, "0")}Z`,
        "carol",
      );
      store.push(created);
      return {
        data: created,
        error: undefined,
        response: new Response(null, { status: 201 }),
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
      GET,
      POST,
      PUT: mock(),
      DELETE: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    GET,
    POST,
    store,
  };
}

const base = { owner: "alice", repo: "contract", pullNumber: 7 };

// --- marker parsing -------------------------------------------------------

test("parseMarker reads kind and thread id", () => {
  expect(parseMarker(`hello\n\n${marker("thread", "abc-123")}`)).toEqual({
    kind: "thread",
    threadId: "abc-123",
    state: undefined,
  });
});

test("parseMarker reads resolution state", () => {
  const parsed = parseMarker(marker("resolve", "abc", "state=resolved"));
  expect(parsed?.kind).toBe("resolve");
  expect(parsed?.state).toBe("resolved");
});

test("parseMarker returns null for unmarked comments", () => {
  expect(parseMarker("just a normal comment")).toBeNull();
});

test("parseMarker rejects an unknown kind", () => {
  expect(parseMarker(marker("delete", "abc"))).toBeNull();
});

test("parseMarker rejects a thread id with illegal characters", () => {
  expect(parseMarker(marker("thread", "abc<script>"))).toBeNull();
});

test("parseMarker takes the last marker so an injected earlier one loses", () => {
  const body = `${marker("resolve", "victim", "state=resolved")}\n\n${marker("thread", "real")}`;
  expect(parseMarker(body)?.threadId).toBe("real");
});

test("stripMarkers removes the marker from the rendered body", () => {
  expect(stripMarkers(`Looks good.\n\n${marker("reply", "abc")}`)).toBe(
    "Looks good.",
  );
});

test("isValidThreadId rejects path traversal and markup", () => {
  expect(isValidThreadId("a-b_c.1")).toBe(true);
  expect(isValidThreadId("../../etc")).toBe(false);
  expect(isValidThreadId("<img>")).toBe(false);
  expect(isValidThreadId("")).toBe(false);
});

// --- forgery protection ---------------------------------------------------

test("stripForgedMarkers removes a resolve marker a user typed themselves", () => {
  const hostile = `Looks fine to me.\n\n${marker("resolve", "other-thread", "state=resolved")}`;
  expect(stripForgedMarkers(hostile)).toBe("Looks fine to me.");
});

test("a forged marker in a new thread body cannot resolve another thread", async () => {
  const existing = [
    comment(
      1,
      `Please fix clause 4.\n\n${marker("thread", "t1")}`,
      "2026-01-01T00:00:00Z",
    ),
  ];
  const { client, store } = createMockClient(existing);

  await createDiscussionThread({
    client,
    ...base,
    body: `Fine by me.\n\n${marker("resolve", "t1", "state=resolved")}`,
  });

  const summary = await listDiscussions({ client, ...base });
  const t1 = summary.threads.find((t) => t.id === "t1");

  expect(t1?.resolved).toBe(false);
  expect(summary.unresolvedCount).toBe(2);
  // The stored body must not carry the forged marker.
  expect(store[1]?.body).not.toContain("kind=resolve");
});

// --- thread grouping ------------------------------------------------------

test("buildThreads groups a root comment with its replies in order", () => {
  const threads = buildThreads([
    comment(
      3,
      `Second reply\n\n${marker("reply", "t1")}`,
      "2026-01-01T00:03:00Z",
    ),
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      `First reply\n\n${marker("reply", "t1")}`,
      "2026-01-01T00:02:00Z",
    ),
  ]);

  expect(threads).toHaveLength(1);
  expect(threads[0]?.comments.map((c) => c.body)).toEqual([
    "Root",
    "First reply",
    "Second reply",
  ]);
});

test("buildThreads resolves a thread from its resolve event", () => {
  const threads = buildThreads([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:02:00Z",
      "bob",
    ),
  ]);

  expect(threads[0]?.resolved).toBe(true);
  expect(threads[0]?.resolvedBy?.login).toBe("bob");
  // The resolve event is not rendered as a comment.
  expect(threads[0]?.comments).toHaveLength(1);
});

test("buildThreads replays events so the last one wins", () => {
  const threads = buildThreads([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:02:00Z",
    ),
    comment(3, marker("resolve", "t1", "state=open"), "2026-01-01T00:03:00Z"),
  ]);

  expect(threads[0]?.resolved).toBe(false);
  // Reopening keeps the full history rather than erasing the resolution.
  expect(threads[0]?.events).toHaveLength(2);
});

test("a reply after a resolve event reopens the thread", () => {
  const threads = buildThreads([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:02:00Z",
      "bob",
    ),
    comment(
      3,
      `Actually, one more thing.\n\n${marker("reply", "t1")}`,
      "2026-01-01T00:03:00Z",
      "carol",
    ),
  ]);

  expect(threads[0]?.resolved).toBe(false);
  expect(threads[0]?.resolvedBy).toBeNull();
  expect(threads[0]?.resolvedAt).toBeNull();
  // The resolution still happened, and the record still says so.
  expect(threads[0]?.events).toHaveLength(1);
  expect(threads[0]?.comments).toHaveLength(2);
});

test("resolving again after a reopening comment settles the thread", () => {
  const threads = buildThreads([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:02:00Z",
    ),
    comment(
      3,
      `One more thing.\n\n${marker("reply", "t1")}`,
      "2026-01-01T00:03:00Z",
    ),
    comment(
      4,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:04:00Z",
      "bob",
    ),
  ]);

  expect(threads[0]?.resolved).toBe(true);
  expect(threads[0]?.resolvedBy?.login).toBe("bob");
});

test("a comment on an unrelated thread does not reopen a resolved one", () => {
  const threads = buildThreads([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
    comment(
      2,
      marker("resolve", "t1", "state=resolved"),
      "2026-01-01T00:02:00Z",
    ),
    comment(3, `Other\n\n${marker("thread", "t2")}`, "2026-01-01T00:03:00Z"),
  ]);

  expect(threads.find((thread) => thread.id === "t1")?.resolved).toBe(true);
});

test("buildThreads breaks timestamp ties with comment id", () => {
  const sameTime = "2026-01-01T00:01:00Z";
  const threads = buildThreads([
    comment(2, marker("resolve", "t1", "state=resolved"), sameTime),
    comment(1, `Root\n\n${marker("thread", "t1")}`, sameTime),
  ]);

  expect(threads[0]?.resolved).toBe(true);
});

test("buildThreads surfaces unmarked comments as external single threads", () => {
  const threads = buildThreads([
    comment(9, "Written in the Gitea UI", "2026-01-01T00:01:00Z"),
  ]);

  expect(threads).toHaveLength(1);
  expect(threads[0]?.origin).toBe("external");
  expect(threads[0]?.id).toBe("c9");
});

test("buildThreads drops a thread that has events but no comments", () => {
  const threads = buildThreads([
    comment(
      1,
      marker("resolve", "ghost", "state=resolved"),
      "2026-01-01T00:01:00Z",
    ),
  ]);

  expect(threads).toHaveLength(0);
});

// --- gating ---------------------------------------------------------------

test("external threads are visible but never gate publication", () => {
  const summary = summarizeThreads(
    buildThreads([
      comment(
        1,
        "Changes requested: fix the indemnity clause",
        "2026-01-01T00:01:00Z",
      ),
      comment(
        2,
        `Real thread\n\n${marker("thread", "t1")}`,
        "2026-01-01T00:02:00Z",
      ),
    ]),
  );

  expect(summary.threads).toHaveLength(2);
  expect(summary.totalCount).toBe(1);
  expect(summary.unresolvedCount).toBe(1);
});

test("unresolvedCount drops to zero once every bindersnap thread resolves", () => {
  const summary = summarizeThreads(
    buildThreads([
      comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
      comment(
        2,
        marker("resolve", "t1", "state=resolved"),
        "2026-01-01T00:02:00Z",
      ),
    ]),
  );

  expect(summary.unresolvedCount).toBe(0);
});

// --- write paths ----------------------------------------------------------

test("createDiscussionThread appends a thread marker with a fresh id", async () => {
  const { client, store } = createMockClient([]);

  const summary = await createDiscussionThread({
    client,
    ...base,
    body: "Clause 4 needs legal sign-off.",
  });

  expect(store).toHaveLength(1);
  expect(store[0]?.body).toContain("kind=thread");
  expect(summary.threads).toHaveLength(1);
  expect(summary.threads[0]?.comments[0]?.body).toBe(
    "Clause 4 needs legal sign-off.",
  );
});

test("createDiscussionThread rejects an empty body", async () => {
  const { client } = createMockClient([]);
  await expect(
    createDiscussionThread({ client, ...base, body: "   " }),
  ).rejects.toThrow(/comment body is required/i);
});

test("replyToDiscussion attaches the reply to the existing thread", async () => {
  const { client } = createMockClient([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
  ]);

  const summary = await replyToDiscussion({
    client,
    ...base,
    threadId: "t1",
    body: "Agreed, updating now.",
  });

  expect(summary.threads).toHaveLength(1);
  expect(summary.threads[0]?.comments).toHaveLength(2);
});

test("replyToDiscussion rejects an unknown thread", async () => {
  const { client } = createMockClient([]);
  await expect(
    replyToDiscussion({ client, ...base, threadId: "nope", body: "hi" }),
  ).rejects.toThrow(/not found/i);
});

test("replyToDiscussion rejects an invalid thread id without calling Gitea", async () => {
  const { client, GET } = createMockClient([]);
  await expect(
    replyToDiscussion({ client, ...base, threadId: "../etc", body: "hi" }),
  ).rejects.toThrow(/invalid thread id/i);
  expect(GET).not.toHaveBeenCalled();
});

test("setDiscussionResolution posts a resolve event and flips state", async () => {
  const { client, store } = createMockClient([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
  ]);

  const summary = await setDiscussionResolution({
    client,
    ...base,
    threadId: "t1",
    resolved: true,
  });

  expect(store).toHaveLength(2);
  expect(store[1]?.body).toContain("state=resolved");
  expect(summary.threads[0]?.resolved).toBe(true);
  expect(summary.unresolvedCount).toBe(0);
});

test("setDiscussionResolution is a no-op when state already matches", async () => {
  const { client, store } = createMockClient([
    comment(1, `Root\n\n${marker("thread", "t1")}`, "2026-01-01T00:01:00Z"),
  ]);

  await setDiscussionResolution({
    client,
    ...base,
    threadId: "t1",
    resolved: false,
  });

  // No duplicate event added to the audit log.
  expect(store).toHaveLength(1);
});

test("setDiscussionResolution refuses to resolve an external comment", async () => {
  const { client } = createMockClient([
    comment(4, "Gitea-native comment", "2026-01-01T00:01:00Z"),
  ]);

  await expect(
    setDiscussionResolution({
      client,
      ...base,
      threadId: "c4",
      resolved: true,
    }),
  ).rejects.toThrow(/not created in Bindersnap/i);
});
