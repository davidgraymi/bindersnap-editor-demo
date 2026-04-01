import { afterEach, beforeEach, expect, test } from "bun:test";

import { handleApiRequest, loadDocumentCatalog } from "./server.ts";

const originalFetch = globalThis.fetch;

type MockResponseBody = Record<string, unknown> | Array<unknown> | string;

function jsonResponse(body: MockResponseBody, init?: ResponseInit): Response {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function createBaseSession() {
  return {
    id: "session-1",
    username: "alice",
    giteaToken: "token-123",
    giteaTokenName: "bindersnap-session-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  } as Parameters<typeof loadDocumentCatalog>[0];
}

function createMockFetchForCatalog(): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (method !== "GET") {
      throw new Error(`Unexpected method ${method} for ${url.pathname}`);
    }

    if (url.pathname === "/api/v1/user/repos") {
      return jsonResponse([
        {
          id: 1,
          name: "quarterly-report",
          full_name: "alice/quarterly-report",
          default_branch: "main",
          owner: { login: "alice" },
        },
      ]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents") {
      return jsonResponse([
        { type: "file", path: "documents/draft.json" },
        { type: "file", path: "documents/in-review.json" },
      ]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents/draft.json") {
      return jsonResponse({
        content: Buffer.from(
          JSON.stringify({
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "Q2 Compliance Report" }],
              },
            ],
          }),
          "utf8",
        ).toString("base64"),
      });
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents/in-review.json") {
      return jsonResponse({
        content: Buffer.from(
          JSON.stringify({
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "Vendor Contract - Acme Corp" }],
              },
            ],
          }),
          "utf8",
        ).toString("base64"),
      });
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/commits") {
      const path = url.searchParams.get("path");
      if (path === "documents/draft.json") {
        return jsonResponse([
          {
            sha: "draft-sha",
            commit: {
              message: "seed: add draft document",
              author: { name: "Alice Author", date: "2026-03-30T12:00:00Z" },
            },
          },
        ]);
      }

      if (path === "documents/in-review.json") {
        return jsonResponse([
          {
            sha: "review-sha",
            commit: {
              message: "seed: update document for review",
              author: { name: "Alice Author", date: "2026-03-31T12:00:00Z" },
            },
          },
        ]);
      }
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls") {
      return jsonResponse([
        {
          number: 12,
          title: "Q2 amendments",
          state: "open",
          head: { ref: "feature/q2-amendments" },
          updated_at: "2026-04-01T12:30:00Z",
        },
      ]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/files") {
      return jsonResponse([{ filename: "documents/in-review.json" }]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/reviews") {
      return jsonResponse([
        {
          state: "REQUEST_CHANGES",
          submitted_at: "2026-04-01T13:00:00Z",
        },
      ]);
    }

    throw new Error(`Unexpected request ${method} ${url.pathname}${url.search}`);
  };
}

function createMockFetchForEmptyRepo(): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (method !== "GET") {
      throw new Error(`Unexpected method ${method} for ${url.pathname}`);
    }

    if (url.pathname === "/api/v1/user/repos") {
      return jsonResponse([
        {
          id: 2,
          name: "blank-workspace",
          full_name: "alice/blank-workspace",
          default_branch: "main",
          owner: { login: "alice" },
        },
      ]);
    }

    if (url.pathname === "/api/v1/repos/alice/blank-workspace/contents/documents") {
      return new Response("", { status: 404 });
    }

    throw new Error(`Unexpected request ${method} ${url.pathname}${url.search}`);
  };
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("handleApiRequest normalizes unauthorized document access", async () => {
  const response = await handleApiRequest(new Request("http://localhost/api/app/documents"));

  expect(response.status).toBe(401);
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
    message?: string;
  };

  expect(payload.error?.code).toBe("unauthorized");
  expect(payload.error?.message).toBe("Unauthorized.");
  expect(payload.message).toBe("Unauthorized.");
});

test("loadDocumentCatalog returns the workspace catalog with published and pending metadata", async () => {
  globalThis.fetch = createMockFetchForCatalog();

  const payload = await loadDocumentCatalog(createBaseSession());

  expect(payload.repository).toBe("alice/quarterly-report");
  expect(payload.documents).toHaveLength(2);

  const draft = payload.documents.find((document) => document.path === "documents/draft.json");
  expect(draft).toBeTruthy();
  expect(draft?.id).toBe("documents/draft.json");
  expect(draft?.title).toBe("Q2 Compliance Report");
  expect(draft?.displayName).toBe("Q2 Compliance Report");
  expect(draft?.publishedVersion?.sha).toBe("draft-sha");
  expect(draft?.latestCommit?.message).toBe("seed: add draft document");
  expect(draft?.latestPendingVersionStatus).toBeNull();
  expect(draft?.lastActivityTimestamp).toBe("2026-03-30T12:00:00Z");

  const inReview = payload.documents.find((document) => document.path === "documents/in-review.json");
  expect(inReview).toBeTruthy();
  expect(inReview?.latestPendingVersionStatus).toBe("changes_requested");
  expect(inReview?.latestPendingPullRequest?.number).toBe(12);
  expect(inReview?.latestPendingPullRequest?.branch).toBe("feature/q2-amendments");
  expect(inReview?.latestPendingPullRequest?.state).toBe("changes_requested");
  expect(inReview?.lastActivityTimestamp).toBe("2026-04-01T13:00:00Z");
});

test("loadDocumentCatalog falls back to an empty catalog when the workspace has no documents directory", async () => {
  globalThis.fetch = createMockFetchForEmptyRepo();

  const payload = await loadDocumentCatalog(createBaseSession());

  expect(payload.repository).toBe("alice/blank-workspace");
  expect(payload.documents).toEqual([]);
});
