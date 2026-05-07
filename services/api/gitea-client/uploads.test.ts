import { expect, mock, test } from "bun:test";
import {
  buildCanonicalDocumentFileName,
  buildUploadBranchName,
  buildUploadCommitMessage,
  createInitialDocumentUpload,
  getFileExtension,
  validateUploadFile,
} from "./uploads";
import type { GiteaClient } from "./client";

function createMockClient(handlers: {
  GET?: Record<string, (...args: any[]) => unknown>;
  POST?: Record<string, (...args: any[]) => unknown>;
  PUT?: Record<string, (...args: any[]) => unknown>;
  DELETE?: Record<string, (...args: any[]) => unknown>;
}) {
  function makeMock(
    methodHandlers?: Record<string, (...args: any[]) => unknown>,
  ) {
    return mock(async (path: string, init?: unknown) => {
      const handler = methodHandlers?.[path];
      if (handler) {
        try {
          const data = await handler(init);
          return {
            data,
            error: undefined,
            response: new Response(null, { status: 200 }),
          };
        } catch (error) {
          return {
            data: undefined,
            error: { message: "not found" },
            response: new Response(null, { status: 404 }),
          };
        }
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    });
  }

  const mockGet = makeMock(handlers.GET);
  const mockPost = makeMock(handlers.POST);
  const mockPut = makeMock(handlers.PUT);
  const mockDelete = makeMock(handlers.DELETE);

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      DELETE: mockDelete,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockDelete,
  };
}

// ────────────────────────────────────────────────────────────────
// validateUploadFile tests
// ────────────────────────────────────────────────────────────────

test("validateUploadFile accepts pdf", () => {
  const file = new File(["content"], "test.pdf", { type: "application/pdf" });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts docx", () => {
  const file = new File(["content"], "test.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts xlsx", () => {
  const file = new File(["content"], "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts any extension — txt", () => {
  const file = new File(["content"], "notes.txt", { type: "text/plain" });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts any extension — zip", () => {
  const file = new File(["content"], "archive.zip", {
    type: "application/zip",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile accepts files without extensions", () => {
  const file = new File(["content"], "Makefile", {
    type: "application/octet-stream",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

test("validateUploadFile rejects files over 25 MiB", () => {
  const largeContent = new Uint8Array(26 * 1024 * 1024);
  const file = new File([largeContent], "large.pdf", {
    type: "application/pdf",
  });
  const result = validateUploadFile(file);
  expect(result.valid).toBe(false);
  expect(result.reason).toContain("File is too large");
  expect(result.reason).toContain("MiB");
});

test("validateUploadFile accepts files exactly at 25 MiB limit", () => {
  const largeContent = new Uint8Array(25 * 1024 * 1024);
  const file = new File([largeContent], "at-limit.pdf", {
    type: "application/pdf",
  });
  expect(validateUploadFile(file).valid).toBe(true);
});

// ────────────────────────────────────────────────────────────────
// filename utility tests
// ────────────────────────────────────────────────────────────────

test("getFileExtension returns the trailing extension when present", () => {
  expect(getFileExtension("quarterly-report-final.docx")).toBe("docx");
  expect(getFileExtension("archive.tar.gz")).toBe("gz");
});

test("getFileExtension returns empty string when no extension exists", () => {
  expect(getFileExtension("Makefile")).toBe("");
  expect(getFileExtension(".env")).toBe("");
});

test("buildCanonicalDocumentFileName normalizes the canonical file name", () => {
  expect(buildCanonicalDocumentFileName("pdf")).toBe("document.pdf");
  expect(buildCanonicalDocumentFileName(".DOCX")).toBe("document.docx");
  expect(buildCanonicalDocumentFileName("")).toBe("document");
});

// ────────────────────────────────────────────────────────────────
// buildUploadBranchName tests
// ────────────────────────────────────────────────────────────────

test("buildUploadBranchName produces correct format", () => {
  const now = new Date("2026-04-02T14:35:22Z");
  const branchName = buildUploadBranchName(
    "quarterly-report",
    "alice",
    "abc12345",
    now,
  );

  expect(branchName).toBe(
    "upload/quarterly-report/20260402/143522Z-alice-abc12345",
  );
});

test("buildUploadBranchName uses UTC time", () => {
  // Test with a date that has different local and UTC times
  const now = new Date("2026-12-31T23:59:59Z");
  const branchName = buildUploadBranchName("doc", "user", "hash1234", now);

  expect(branchName).toBe("upload/doc/20261231/235959Z-user-hash1234");
});

test("buildUploadBranchName pads single-digit months and days", () => {
  const now = new Date("2026-01-05T08:09:07Z");
  const branchName = buildUploadBranchName("test-doc", "bob", "12345678", now);

  expect(branchName).toBe("upload/test-doc/20260105/080907Z-bob-12345678");
});

test("buildUploadBranchName handles different doc slugs", () => {
  const now = new Date("2026-04-02T12:00:00Z");
  const branchName = buildUploadBranchName(
    "policy-handbook-v2",
    "charlie",
    "abcdef12",
    now,
  );

  expect(branchName).toBe(
    "upload/policy-handbook-v2/20260402/120000Z-charlie-abcdef12",
  );
});

// ────────────────────────────────────────────────────────────────
// buildUploadCommitMessage tests
// ────────────────────────────────────────────────────────────────

test("buildUploadCommitMessage includes all required trailers", () => {
  const message = buildUploadCommitMessage({
    docSlug: "quarterly-report",
    canonicalFile: "quarterly-report.pdf",
    sourceFilename: "Q2_Report_Final.pdf",
    uploadBranch: "upload/quarterly-report/20260402/143522Z-alice-abc12345",
    uploaderSlug: "alice",
    fileHashSha256: "abc123def456789",
  });

  expect(message).toContain("Bindersnap-Document-Id: quarterly-report");
  expect(message).toContain("Bindersnap-Canonical-File: quarterly-report.pdf");
  expect(message).toContain("Bindersnap-Source-Filename: Q2_Report_Final.pdf");
  expect(message).toContain(
    "Bindersnap-Upload-Branch: upload/quarterly-report/20260402/143522Z-alice-abc12345",
  );
  expect(message).toContain("Bindersnap-Uploaded-By: alice");
  expect(message).toContain("Bindersnap-File-Hash-SHA256: abc123def456789");
});

test("buildUploadCommitMessage format", () => {
  const message = buildUploadCommitMessage({
    docSlug: "test-doc",
    canonicalFile: "test-doc.docx",
    sourceFilename: "original.docx",
    uploadBranch: "upload/test-doc/20260402/120000Z-user-12345678",
    uploaderSlug: "user",
    fileHashSha256: "hash123",
  });

  const lines = message.split("\n");

  // First line is the summary
  expect(lines[0]).toBe("Upload: original.docx");

  // Second line is blank
  expect(lines[1]).toBe("");

  // Remaining lines are trailers
  expect(lines[2]).toMatch(/^Bindersnap-/);
});

test("buildUploadCommitMessage handles special characters in filenames", () => {
  const message = buildUploadCommitMessage({
    docSlug: "doc-with-dashes",
    canonicalFile: "doc-with-dashes.pdf",
    sourceFilename: "File (with) [special] chars & stuff.pdf",
    uploadBranch: "upload/doc-with-dashes/20260402/120000Z-user-12345678",
    uploaderSlug: "user-name",
    fileHashSha256: "abc123",
  });

  expect(message).toContain("Upload: File (with) [special] chars & stuff.pdf");
  expect(message).toContain(
    "Bindersnap-Source-Filename: File (with) [special] chars & stuff.pdf",
  );
});

test("createInitialDocumentUpload creates the repo, bootstraps main, and opens a PR", async () => {
  const file = new File(["hello world"], "Quarterly Report Final.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const { client, mockPost, mockDelete } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/contents/{filepath}": (init: {
        params?: { path?: { filepath?: string } };
        query?: { ref?: string };
      }) => {
        // README.md exists on main (for bootstrap deletion);
        // document.docx does NOT exist on the upload branch yet.
        if (init?.params?.path?.filepath === "README.md") {
          return { sha: "readme-sha", type: "file" };
        }
        throw { status: 404, message: "not found" };
      },
      "/repos/{owner}/{repo}/pulls/{index}/reviews": () => [],
    },
    POST: {
      "/user/repos": (init: {
        body?: {
          name?: string;
          private?: boolean;
          auto_init?: boolean;
          default_branch?: string;
          description?: string;
        };
      }) => ({
        id: 99,
        name: init?.body?.name,
        full_name: `alice/${init?.body?.name ?? ""}`,
        owner: { login: "alice" },
      }),
      "/repos/{owner}/{repo}/branch_protections": (init: {
        body?: { rule_name?: string; required_approvals?: number };
      }) => ({
        rule_name: init?.body?.rule_name,
        required_approvals: init?.body?.required_approvals,
      }),
      "/repos/{owner}/{repo}/branches": (init: {
        body?: { new_branch_name?: string; old_branch_name?: string };
      }) => ({
        name: init?.body?.new_branch_name,
      }),
      "/repos/{owner}/{repo}/contents/{filepath}": (init: {
        params?: { path?: { filepath?: string } };
        body?: { content?: string; message?: string; branch?: string };
      }) => ({
        commit: { sha: "commit-sha" },
        content: {
          path: init?.params?.path?.filepath,
        },
      }),
      "/repos/{owner}/{repo}/pulls": (init: {
        body?: { title?: string; head?: string; base?: string };
      }) => ({
        number: 17,
        title: init?.body?.title,
      }),
    },
    DELETE: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({}),
    },
  });

  const originalFileReader = globalThis.FileReader;
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    onload:
      | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
      | null = null;
    onerror:
      | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
      | null = null;

    readAsDataURL() {
      this.result = "data:application/octet-stream;base64,aGVsbG8gd29ybGQ=";
      this.onload?.(new Event("load") as unknown as ProgressEvent<FileReader>);
    }
  }
  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

  try {
    const { computeFileHash, createInitialDocumentUpload } =
      await import("./uploads");
    const fullHash = await computeFileHash(file);

    const result = await createInitialDocumentUpload({
      client,
      repoName: "quarterly-report",
      file,
      uploaderSlug: "alice",
      nextVersion: 1,
    });

    expect(result.owner).toBe("alice");
    expect(result.repo).toBe("quarterly-report");
    expect(result.canonicalFile).toBe("document.docx");
    expect(result.prNumber).toBe(17);
    expect(result.prTitle).toBe("Upload v1: Quarterly Report");
    expect(result.commitSha).toBe("commit-sha");
    expect(mockDelete).toHaveBeenCalled();

    const postCalls = mockPost.mock.calls as Array<
      [
        string,
        {
          body?: {
            name?: string;
            private?: boolean;
            auto_init?: boolean;
            default_branch?: string;
            rule_name?: string;
            required_approvals?: number;
            new_branch_name?: string;
            old_branch_name?: string;
            content?: string;
            message?: string;
            branch?: string;
            title?: string;
            head?: string;
            base?: string;
          };
        },
      ]
    >;

    expect(
      postCalls.find(([path]) => path === "/user/repos")?.[1]?.body,
    ).toMatchObject({
      name: "quarterly-report",
      private: true,
      auto_init: true,
      default_branch: "main",
    });
    expect(
      postCalls.find(
        ([path]) => path === "/repos/{owner}/{repo}/branch_protections",
      )?.[1]?.body,
    ).toMatchObject({
      rule_name: "main",
      required_approvals: 1,
      enable_approvals_whitelist: false,
      enable_merge_whitelist: false,
      block_on_rejected_reviews: true,
    });

    const branchCall = postCalls.find(
      ([path]) => path === "/repos/{owner}/{repo}/branches",
    );
    expect(branchCall?.[1]?.body?.old_branch_name).toBe("main");
    expect(branchCall?.[1]?.body?.new_branch_name).toContain(
      "upload/quarterly-report/",
    );
    expect(branchCall?.[1]?.body?.new_branch_name).toContain(
      `-alice-${fullHash.slice(0, 8)}`,
    );

    const fileCall = postCalls.find(
      ([path]) => path === "/repos/{owner}/{repo}/contents/{filepath}",
    );
    expect(fileCall?.[0]).toBe("/repos/{owner}/{repo}/contents/{filepath}");
    expect(fileCall?.[1]?.params?.path?.filepath).toBe("document.docx");
    expect(fileCall?.[1]?.body).toMatchObject({
      branch: result.branchName,
    });
    expect(fileCall?.[1]?.body?.message).toContain(
      "Bindersnap-Canonical-File: document.docx",
    );

    const prCall = postCalls.find(
      ([path]) => path === "/repos/{owner}/{repo}/pulls",
    );
    expect(prCall?.[1]?.body).toMatchObject({
      title: "Upload v1: Quarterly Report",
      head: result.branchName,
      base: "main",
    });
  } finally {
    globalThis.FileReader = originalFileReader;
  }
});
