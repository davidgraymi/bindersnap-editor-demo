import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import { searchInvolvedChanges } from "./pullRequests";

interface SearchIssue {
  number: number;
  updated_at?: string;
  created_at?: string;
  repository?: { full_name: string };
}

/**
 * A client whose issue search answers per involvement filter.
 *
 * The four filters are four separate requests, so a test says what each one
 * finds and the function is judged on how it combines them.
 */
function createSearchClient(byFilter: Record<string, SearchIssue[] | "fail">): {
  client: GiteaClient;
  calls: () => Record<string, unknown>[];
} {
  const seen: Record<string, unknown>[] = [];

  const mockGet = mock(
    async (
      path: string,
      init?: { params?: { query?: Record<string, unknown> } },
    ) => {
      const query = init?.params?.query ?? {};
      seen.push(query);

      if (path !== "/repos/issues/search") {
        return {
          data: undefined,
          error: { message: "unexpected path" },
          response: new Response(null, { status: 404 }),
        };
      }

      const filter =
        ["created", "review_requested", "reviewed", "assigned"].find(
          (name) => query[name] === true,
        ) ??
        (typeof query.owner === "string" ? `owner:${query.owner}` : undefined);
      const answer = filter ? byFilter[filter] : undefined;

      if (answer === "fail") {
        return {
          data: undefined,
          error: { message: "gitea said no" },
          response: new Response(null, { status: 500 }),
        };
      }

      return {
        data: answer ?? [],
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    },
  );

  return {
    client: { GET: mockGet } as unknown as GiteaClient,
    calls: () => seen,
  };
}

const issue = (
  fullName: string,
  number: number,
  updatedAt: string,
): SearchIssue => ({
  number,
  updated_at: updatedAt,
  repository: { full_name: fullName },
});

test("asks every involvement filter for the requested state", async () => {
  const { client, calls } = createSearchClient({});

  await searchInvolvedChanges({ client, state: "open" });

  const queries = calls();
  expect(queries).toHaveLength(4);
  for (const query of queries) {
    expect(query.type).toBe("pulls");
    expect(query.state).toBe("open");
  }
  expect(queries.filter((q) => q.created === true)).toHaveLength(1);
  expect(queries.filter((q) => q.review_requested === true)).toHaveLength(1);
  expect(queries.filter((q) => q.reviewed === true)).toHaveLength(1);
  expect(queries.filter((q) => q.assigned === true)).toHaveLength(1);
});

test("unions the filters and counts a change once", async () => {
  // The same change can be one the reader created and one they were asked to
  // review; it is still a single row.
  const { client } = createSearchClient({
    created: [issue("alice/handbook", 4, "2026-09-01T10:00:00Z")],
    review_requested: [issue("alice/handbook", 4, "2026-09-01T10:00:00Z")],
    reviewed: [issue("bob/policy", 9, "2026-09-02T10:00:00Z")],
  });

  const refs = await searchInvolvedChanges({ client, state: "open" });

  expect(refs).toEqual([
    {
      owner: "bob",
      repo: "policy",
      number: 9,
      updatedAt: "2026-09-02T10:00:00Z",
    },
    {
      owner: "alice",
      repo: "handbook",
      number: 4,
      updatedAt: "2026-09-01T10:00:00Z",
    },
  ]);
});

test("orders by most recent movement so a caller may truncate", async () => {
  const { client } = createSearchClient({
    created: [
      issue("a/one", 1, "2026-08-01T00:00:00Z"),
      issue("a/two", 2, "2026-09-02T00:00:00Z"),
      issue("a/three", 3, "2026-08-20T00:00:00Z"),
    ],
  });

  const refs = await searchInvolvedChanges({ client, state: "closed" });

  expect(refs.map((ref) => ref.repo)).toEqual(["two", "three", "one"]);
});

test("keeps the filters that answered when one fails", async () => {
  const { client } = createSearchClient({
    created: [issue("alice/handbook", 4, "2026-09-01T10:00:00Z")],
    review_requested: "fail",
  });

  const refs = await searchInvolvedChanges({ client, state: "open" });

  expect(refs).toHaveLength(1);
  expect(refs[0]?.repo).toBe("handbook");
});

test("skips results that name no repository or no number", async () => {
  const { client } = createSearchClient({
    created: [
      { number: 5, updated_at: "2026-09-01T00:00:00Z" },
      {
        number: 6,
        updated_at: "2026-09-01T00:00:00Z",
        repository: { full_name: "nameless" },
      },
      issue("alice/handbook", 7, "2026-09-01T00:00:00Z"),
    ],
  });

  const refs = await searchInvolvedChanges({ client, state: "open" });

  expect(refs).toEqual([
    {
      owner: "alice",
      repo: "handbook",
      number: 7,
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ]);
});

test("passes the caller's limit to each filter", async () => {
  const { client, calls } = createSearchClient({});

  await searchInvolvedChanges({ client, state: "closed", limit: 12 });

  for (const query of calls()) {
    expect(query.limit).toBe(12);
  }
});

test("does not ask by owner unless a reader is named", async () => {
  const { client, calls } = createSearchClient({});

  await searchInvolvedChanges({ client, state: "open" });

  expect(calls()).toHaveLength(4);
  expect(calls().some((query) => "owner" in query)).toBe(false);
});

test("finds changes on a document the reader owns but never touched", async () => {
  // Bob submitted a change to Alice's document and never asked her to review
  // it. She owns the document, so it is still hers to see — and none of the
  // "did you touch it" filters will find it.
  const { client, calls } = createSearchClient({
    "owner:alice": [issue("alice/handbook", 3, "2026-09-01T00:00:00Z")],
  });

  const refs = await searchInvolvedChanges({
    client,
    state: "open",
    ownedBy: "alice",
  });

  expect(calls()).toHaveLength(5);
  expect(refs).toEqual([
    {
      owner: "alice",
      repo: "handbook",
      number: 3,
      updatedAt: "2026-09-01T00:00:00Z",
    },
  ]);
});

test("counts an owned change once when the reader also submitted it", async () => {
  const { client } = createSearchClient({
    created: [issue("alice/handbook", 3, "2026-09-01T00:00:00Z")],
    "owner:alice": [issue("alice/handbook", 3, "2026-09-01T00:00:00Z")],
  });

  const refs = await searchInvolvedChanges({
    client,
    state: "open",
    ownedBy: "alice",
  });

  expect(refs).toHaveLength(1);
});
