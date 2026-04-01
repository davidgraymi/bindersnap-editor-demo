import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "crypto";

import {
  handleApiRequest,
  loadDocumentCatalog,
  publishDocumentVersion,
  reviewDocumentVersion,
  uploadDocumentVersion,
} from "./server.ts";

const originalFetch = globalThis.fetch;
const UPLOAD_BRANCH_NAME = `bindersnap/upload/main/documents-draft-json-${createHash("sha1")
  .update("documents/draft.json")
  .digest("hex")
  .slice(0, 12)}`;
const ENCODED_UPLOAD_BRANCH_NAME = encodeURIComponent(UPLOAD_BRANCH_NAME);

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

function createUploadSession() {
  return {
    id: "session-2",
    username: "alice",
    giteaToken: "token-123",
    giteaTokenName: "bindersnap-session-2",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  } as Parameters<typeof uploadDocumentVersion>[0];
}

function createReviewerSession(username = "alice") {
  return {
    id: `${username}-session`,
    username,
    giteaToken: "token-123",
    giteaTokenName: `${username}-bindersnap-session`,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  } as Parameters<typeof reviewDocumentVersion>[0];
}

function createUploadFormData(content: string, fileName = "updated-draft.json") {
  const formData = new FormData();
  formData.set(
    "file",
    new File([content], fileName, {
      type: "application/json",
    }),
  );
  formData.set("summary", "Updated wording for review");
  formData.set("source_note", "Word export from legal");
  return formData;
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

function createMockFetchForUploadLifecycle() {
  const canonicalContent = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Q2 Compliance Report" }],
      },
    ],
  });

  const uploadContent = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Q2 Compliance Report v2" }],
      },
    ],
  });

  const state = {
    branchExists: false,
    branchContent: canonicalContent,
    branchFileSha: "canonical-file-sha",
    branchCommitSha: "canonical-commit-sha",
    publishedContent: canonicalContent,
    publishedFileSha: "canonical-file-sha",
    publishedCommitSha: "canonical-commit-sha",
    publishedCommitMessage: "seed: draft document",
    branchCommitCount: 0,
    mergeCount: 0,
    reviews: [] as Array<{
      id: number;
      state: string;
      body: string;
      user: { login: string };
      submitted_at: string;
    }>,
    pullRequest: null as null | {
      number: number;
      title: string;
      body: string;
      head: { ref: string };
      state: string;
      updated_at: string;
      created_at: string;
      html_url: string;
      merged?: boolean;
      merged_at?: string;
    },
    branchCreateCount: 0,
    fileWriteCount: 0,
    pullCreateCount: 0,
    pullPatchCount: 0,
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (url.pathname === "/api/v1/user/repos" && method === "GET") {
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

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents" && method === "GET") {
      return jsonResponse([
        { type: "file", path: "documents/draft.json" },
      ]);
    }

    if (
      url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents/draft.json" &&
      method === "GET"
    ) {
      const ref = url.searchParams.get("ref");
      if (ref === "main") {
        return jsonResponse({
          sha: state.publishedFileSha,
          content: Buffer.from(state.publishedContent, "utf8").toString("base64"),
        });
      }

      if (ref === UPLOAD_BRANCH_NAME && state.branchExists) {
        return jsonResponse({
          sha: state.branchFileSha,
          content: Buffer.from(state.branchContent, "utf8").toString("base64"),
        });
      }
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/commits" && method === "GET") {
      const path = url.searchParams.get("path");
      const sha = url.searchParams.get("sha");

      if (path === "documents/draft.json" && sha === "main") {
        return jsonResponse([
          {
            sha: state.publishedCommitSha,
            commit: {
              message: state.publishedCommitMessage,
              author: { name: "Alice Author", date: "2026-04-01T16:00:00Z" },
            },
          },
        ]);
      }

      if (path === "documents/draft.json" && sha === UPLOAD_BRANCH_NAME && state.branchExists) {
        return jsonResponse([
          {
            sha: state.branchCommitSha,
            commit: {
              message: "Upload new version for Q2 Compliance Report",
              author: { name: "Alice Author", date: "2026-04-01T15:00:00Z" },
            },
          },
        ]);
      }
    }

    if (
      url.pathname === `/api/v1/repos/alice/quarterly-report/branches/${ENCODED_UPLOAD_BRANCH_NAME}` &&
      method === "GET"
    ) {
      return state.branchExists ? jsonResponse({ name: UPLOAD_BRANCH_NAME }) : new Response("", { status: 404 });
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/branches" && method === "POST") {
      state.branchExists = true;
      state.branchCreateCount += 1;
      state.branchContent = canonicalContent;
      state.branchFileSha = "canonical-file-sha";
      state.branchCommitSha = "canonical-commit-sha";
      state.publishedContent = canonicalContent;
      state.publishedFileSha = "canonical-file-sha";
      state.publishedCommitSha = "canonical-commit-sha";
      state.publishedCommitMessage = "seed: draft document";
      return new Response("", { status: 201 });
    }

    if (
      url.pathname === "/api/v1/repos/alice/quarterly-report/contents/documents/draft.json" &&
      (method === "PUT" || method === "POST")
    ) {
      state.fileWriteCount += 1;
      const body = typeof init?.body === "string" ? init.body : "";
      const parsed = body ? (JSON.parse(body) as { content?: string }) : {};
      state.branchContent = parsed.content ? Buffer.from(parsed.content, "base64").toString("utf8") : state.branchContent;
      state.branchCommitCount += 1;
      state.branchFileSha = `branch-file-sha-${state.branchCommitCount}`;
      state.branchCommitSha = `branch-commit-sha-${state.branchCommitCount}`;
      return jsonResponse({
        commit: {
          sha: state.branchCommitSha,
        },
        content: {
          sha: state.branchFileSha,
        },
      });
    }

    if (
      url.pathname === "/api/v1/repos/alice/quarterly-report/pulls" &&
      method === "GET" &&
      url.searchParams.get("state") === "open"
    ) {
      const head = url.searchParams.get("head");
      if (head === `alice:${UPLOAD_BRANCH_NAME}` && state.pullRequest) {
        return jsonResponse([
          {
            number: state.pullRequest.number,
            title: state.pullRequest.title,
            body: state.pullRequest.body,
            state: state.pullRequest.state,
            head: state.pullRequest.head,
            updated_at: state.pullRequest.updated_at,
            created_at: state.pullRequest.created_at,
            html_url: state.pullRequest.html_url,
          },
        ]);
      }

      return jsonResponse([]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12" && method === "GET") {
      if (!state.pullRequest) {
        return new Response("", { status: 404 });
      }

      return jsonResponse({
        number: state.pullRequest.number,
        title: state.pullRequest.title,
        body: state.pullRequest.body,
        state: state.pullRequest.state,
        head: state.pullRequest.head,
        updated_at: state.pullRequest.updated_at,
        created_at: state.pullRequest.created_at,
        html_url: state.pullRequest.html_url,
        merged: state.pullRequest.merged ?? false,
        merged_at: state.pullRequest.merged_at,
      });
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/files" && method === "GET") {
      return jsonResponse([{ filename: "documents/draft.json" }]);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls" && method === "POST") {
      state.pullCreateCount += 1;
      state.pullRequest = {
        number: 12,
        title: "Upload review: Q2 Compliance Report (updated-draft.json)",
        body: "Upload review for Q2 Compliance Report",
        head: { ref: UPLOAD_BRANCH_NAME },
        state: "open",
        updated_at: "2026-04-01T15:00:00Z",
        created_at: "2026-04-01T15:00:00Z",
        html_url: "https://gitea.example/alice/quarterly-report/pulls/12",
      };
      return jsonResponse(state.pullRequest, { status: 201 });
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/issues/12" && method === "PATCH") {
      state.pullPatchCount += 1;
      state.pullRequest = {
        ...(state.pullRequest ?? {
          number: 12,
          head: { ref: UPLOAD_BRANCH_NAME },
          state: "open",
          updated_at: "2026-04-01T15:00:00Z",
          created_at: "2026-04-01T15:00:00Z",
          html_url: "https://gitea.example/alice/quarterly-report/pulls/12",
        }),
        ...(typeof init?.body === "string" ? (JSON.parse(init.body) as { title?: string; body?: string }) : {}),
        updated_at: `2026-04-01T15:0${state.pullPatchCount}:00Z`,
      };
      return jsonResponse(state.pullRequest);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/reviews" && method === "GET") {
      return jsonResponse(state.reviews);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/reviews" && method === "POST") {
      const body = typeof init?.body === "string" ? init.body : "";
      const parsed = body ? (JSON.parse(body) as { event?: string; body?: string }) : {};
      const createdAt = `2026-04-01T15:0${state.reviews.length + 1}:00Z`;
      const reviewState =
        parsed.event === "APPROVE"
          ? "APPROVED"
          : parsed.event === "REQUEST_CHANGES"
            ? "REQUEST_CHANGES"
            : "COMMENT";
      const review = {
        id: state.reviews.length + 1,
        state: reviewState,
        body: parsed.body ?? "",
        user: { login: "alice" },
        submitted_at: createdAt,
      };
      state.reviews = [...state.reviews, review];
      state.pullRequest = {
        ...(state.pullRequest ?? {
          number: 12,
          title: "Upload review: Q2 Compliance Report (updated-draft.json)",
          body: "Upload review for Q2 Compliance Report",
          head: { ref: UPLOAD_BRANCH_NAME },
          state: "open",
          updated_at: createdAt,
          created_at: "2026-04-01T15:00:00Z",
          html_url: "https://gitea.example/alice/quarterly-report/pulls/12",
        }),
        updated_at: createdAt,
      };
      return jsonResponse(review);
    }

    if (url.pathname === "/api/v1/repos/alice/quarterly-report/pulls/12/merge" && method === "POST") {
      state.mergeCount += 1;
      state.publishedContent = state.branchContent;
      state.publishedFileSha = state.branchFileSha;
      state.publishedCommitSha = `published-commit-sha-${state.mergeCount}`;
      state.publishedCommitMessage = "Publish for Q2 Compliance Report";
      state.pullRequest = {
        ...(state.pullRequest ?? {
          number: 12,
          title: "Upload review: Q2 Compliance Report (updated-draft.json)",
          body: "Upload review for Q2 Compliance Report",
          head: { ref: UPLOAD_BRANCH_NAME },
          state: "open",
          updated_at: "2026-04-01T15:00:00Z",
          created_at: "2026-04-01T15:00:00Z",
          html_url: "https://gitea.example/alice/quarterly-report/pulls/12",
        }),
        state: "closed",
        merged: true,
        merged_at: "2026-04-01T16:00:00Z",
        updated_at: "2026-04-01T16:00:00Z",
      };
      return jsonResponse({
        merged: true,
        sha: state.publishedCommitSha,
        merged_commit_id: state.publishedCommitSha,
      });
    }

    throw new Error(`Unexpected request ${method} ${url.pathname}${url.search}`);
  };

  return {
    fetchImpl,
    state,
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

test("handleApiRequest normalizes unauthorized upload access", async () => {
  const formData = createUploadFormData("uploaded content");
  const response = await handleApiRequest(
    new Request("http://localhost/api/app/documents/documents%2Fdraft.json/versions", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
      },
      body: formData,
    }),
  );

  expect(response.status).toBe(401);
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
    message?: string;
  };

  expect(payload.error?.code).toBe("unauthorized");
  expect(payload.error?.message).toBe("Unauthorized.");
  expect(payload.message).toBe("Unauthorized.");
});

test("handleApiRequest normalizes unauthorized version review access", async () => {
  const response = await handleApiRequest(
    new Request("http://localhost/api/app/documents/documents%2Fdraft.json/versions/12/review", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "APPROVE" }),
    }),
  );

  expect(response.status).toBe(401);
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
    message?: string;
  };

  expect(payload.error?.code).toBe("unauthorized");
  expect(payload.error?.message).toBe("Unauthorized.");
  expect(payload.message).toBe("Unauthorized.");
});

test("handleApiRequest normalizes unauthorized version publish access", async () => {
  const response = await handleApiRequest(
    new Request("http://localhost/api/app/documents/documents%2Fdraft.json/versions/12/publish", {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
      },
    }),
  );

  expect(response.status).toBe(401);
  const payload = (await response.json()) as {
    error?: { code?: string; message?: string };
    message?: string;
  };

  expect(payload.error?.code).toBe("unauthorized");
  expect(payload.error?.message).toBe("Unauthorized.");
  expect(payload.message).toBe("Unauthorized.");
});

test("uploadDocumentVersion rejects missing multipart file input", async () => {
  await expect(uploadDocumentVersion(createUploadSession(), "documents/draft.json", new FormData())).rejects.toMatchObject({
    status: 400,
    code: "missing_file",
  });
});

test("uploadDocumentVersion rejects unsupported file types", async () => {
  const formData = new FormData();
  formData.set("file", new File(["binary"], "payload.exe", { type: "application/octet-stream" }));

  await expect(uploadDocumentVersion(createUploadSession(), "documents/draft.json", formData)).rejects.toMatchObject({
    status: 400,
    code: "unsupported_file_type",
  });
});

test("uploadDocumentVersion rejects oversized files", async () => {
  const oversized = new Uint8Array(26 * 1024 * 1024);
  const formData = new FormData();
  formData.set("file", new File([oversized], "huge.pdf", { type: "application/pdf" }));

  await expect(uploadDocumentVersion(createUploadSession(), "documents/draft.json", formData)).rejects.toMatchObject({
    status: 413,
    code: "file_too_large",
  });
});

test("uploadDocumentVersion creates a deterministic branch and reuses it for duplicate uploads", async () => {
  const { fetchImpl, state } = createMockFetchForUploadLifecycle();
  globalThis.fetch = fetchImpl;

  const formData = createUploadFormData(
    JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Q2 Compliance Report v2" }],
        },
      ],
    }),
  );

  const firstResult = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    formData,
  );

  const secondResult = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    formData,
  );

  expect(firstResult.documentId).toBe("documents/draft.json");
  expect(firstResult.branchName).toBe(UPLOAD_BRANCH_NAME);
  expect(firstResult.commitSha).toBe("branch-commit-sha-1");
  expect(firstResult.pullRequestNumber).toBe(12);
  expect(firstResult.pullRequestUrl).toBe("https://gitea.example/alice/quarterly-report/pulls/12");
  expect(firstResult.approvalState).toBe("in_review");

  expect(secondResult.branchName).toBe(firstResult.branchName);
  expect(secondResult.commitSha).toBe(firstResult.commitSha);
  expect(secondResult.pullRequestNumber).toBe(firstResult.pullRequestNumber);
  expect(secondResult.approvalState).toBe(firstResult.approvalState);
  expect(state.branchCreateCount).toBe(1);
  expect(state.fileWriteCount).toBe(1);
  expect(state.pullCreateCount).toBe(1);
  expect(state.pullPatchCount).toBe(1);
});

test("reviewDocumentVersion approves an uploaded version and returns audit metadata", async () => {
  const { fetchImpl, state } = createMockFetchForUploadLifecycle();
  globalThis.fetch = fetchImpl;

  const uploaded = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    createUploadFormData(
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Q2 Compliance Report v2" }],
          },
        ],
      }),
    ),
  );

  const reviewed = await reviewDocumentVersion(
    createReviewerSession(),
    "documents/draft.json",
    uploaded.pullRequestNumber,
    "APPROVE",
    "Looks good to me.",
  );

  expect(reviewed.documentId).toBe("documents/draft.json");
  expect(reviewed.branchName).toBe(UPLOAD_BRANCH_NAME);
  expect(reviewed.pullRequestNumber).toBe(uploaded.pullRequestNumber);
  expect(reviewed.approvalState).toBe("approved");
  expect(reviewed.review.state).toBe("APPROVED");
  expect(reviewed.review.body).toBe("Looks good to me.");
  expect(reviewed.review.reviewer).toBe("alice");
  expect(reviewed.pullRequest.state).toBe("open");
  expect(reviewed.commit?.sha).toBe("branch-commit-sha-1");
  expect(state.reviews).toHaveLength(1);
});

test("reviewDocumentVersion accepts comment payloads and preserves in-review state", async () => {
  const { fetchImpl, state } = createMockFetchForUploadLifecycle();
  globalThis.fetch = fetchImpl;

  const uploaded = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    createUploadFormData(
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Q2 Compliance Report v2" }],
          },
        ],
      }),
    ),
  );

  const reviewed = await reviewDocumentVersion(
    createReviewerSession(),
    "documents/draft.json",
    uploaded.pullRequestNumber,
    "COMMENT",
    "Please tighten section 4.2.",
  );

  expect(reviewed.approvalState).toBe("in_review");
  expect(reviewed.review.state).toBe("COMMENT");
  expect(reviewed.review.body).toBe("Please tighten section 4.2.");
  expect(reviewed.pullRequest.state).toBe("open");
  expect(state.reviews).toHaveLength(1);
});

test("publishDocumentVersion rejects non-owner sessions", async () => {
  const { fetchImpl } = createMockFetchForUploadLifecycle();
  globalThis.fetch = fetchImpl;

  const uploaded = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    createUploadFormData(
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Q2 Compliance Report v2" }],
          },
        ],
      }),
    ),
  );

  await reviewDocumentVersion(
    createReviewerSession(),
    "documents/draft.json",
    uploaded.pullRequestNumber,
    "APPROVE",
    "Looks good to me.",
  );

  await expect(
    publishDocumentVersion(
      createReviewerSession("bob"),
      "documents/draft.json",
      uploaded.pullRequestNumber,
    ),
  ).rejects.toMatchObject({
    status: 403,
    code: "publish_forbidden",
  });
});

test("publishDocumentVersion merges an approved version and returns published metadata", async () => {
  const { fetchImpl, state } = createMockFetchForUploadLifecycle();
  globalThis.fetch = fetchImpl;

  const uploaded = await uploadDocumentVersion(
    createUploadSession(),
    "documents/draft.json",
    createUploadFormData(
      JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Q2 Compliance Report v2" }],
          },
        ],
      }),
    ),
  );

  await reviewDocumentVersion(
    createReviewerSession(),
    "documents/draft.json",
    uploaded.pullRequestNumber,
    "APPROVE",
    "Looks good to me.",
  );

  const published = await publishDocumentVersion(
    createReviewerSession(),
    "documents/draft.json",
    uploaded.pullRequestNumber,
  );

  expect(published.documentId).toBe("documents/draft.json");
  expect(published.branchName).toBe(UPLOAD_BRANCH_NAME);
  expect(published.pullRequestNumber).toBe(uploaded.pullRequestNumber);
  expect(published.approvalState).toBe("published");
  expect(published.publishedVersion?.sha).toBe("published-commit-sha-1");
  expect(published.commit?.sha).toBe("published-commit-sha-1");
  expect(published.pullRequest.state).toBe("closed");
  expect(state.mergeCount).toBe(1);
  expect(state.publishedCommitSha).toBe("published-commit-sha-1");
});
