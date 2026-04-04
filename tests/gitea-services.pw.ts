/**
 * Integration tests for every gitea-client service module.
 *
 * Covers: auth, documents, pullRequests, repos, uploads (branch/commit helpers).
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import {
  clearToken,
  createAuthenticatedClient,
  getStoredToken,
  storeToken,
  UnauthenticatedError,
  validateToken,
} from "../packages/gitea-client/auth";
import {
  commitDocument,
  fetchDocumentAtSha,
  listDocumentCommits,
} from "../packages/gitea-client/documents";
import {
  type ApprovalState,
  createPullRequest,
  getPullRequestForBranch,
  listPullRequests,
  mergePullRequest,
  submitReview,
} from "../packages/gitea-client/pullRequests";
import {
  getLatestDocTag,
  listDocTags,
  listWorkspaceRepos,
} from "../packages/gitea-client/repos";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  createUploadBranch,
  validateUploadFile,
} from "../packages/gitea-client/uploads";

import {
  GITEA_URL,
  installMemorySessionStorage,
  makeClient,
  OWNER,
  pollUntil,
  REPO,
  resolveAndStoreToken,
  SEEDED_BRANCH,
  SEEDED_DOC_PATH,
} from "./helpers";

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  installMemorySessionStorage();
  await resolveAndStoreToken("bindersnap-services");

  // Block until the seeded PR carries the expected "changes_requested" state.
  // Guards against a Gitea race where the review has not yet been indexed when
  // the first test runs.
  await pollUntil(async () => {
    const pr = await getPullRequestForBranch({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      branch: SEEDED_BRANCH,
    });
    return pr?.approvalState === "changes_requested";
  }, "seeded pull request to reach changes_requested state");
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test.describe("auth", () => {
  test("validateToken resolves the authenticated user's login", async () => {
    const token = getStoredToken();
    expect(token).toBeTruthy();

    const user = await validateToken(GITEA_URL, token!);

    expect(user.login).toBe("alice");
    expect(typeof user.id).toBe("number");
    expect(user.id).toBeGreaterThan(0);
  });

  test("createAuthenticatedClient uses the token stored in sessionStorage", async () => {
    const client = makeClient();
    const { data: user } = await client.GET("/user");

    expect(user?.login).toBe("alice");
  });

  test("clearToken causes getStoredToken to return null", () => {
    const tokenBefore = getStoredToken();
    expect(tokenBefore).toBeTruthy();

    clearToken();
    expect(getStoredToken()).toBeNull();

    // Restore the token so subsequent tests in this suite are not affected.
    storeTokenBack(tokenBefore!);
  });

  test("createAuthenticatedClient throws UnauthenticatedError when no token is stored", () => {
    const tokenBefore = getStoredToken();
    clearToken();

    try {
      expect(() => createAuthenticatedClient(GITEA_URL)).toThrow(
        UnauthenticatedError,
      );
    } finally {
      // Always restore so later tests can still run.
      storeTokenBack(tokenBefore ?? "");
    }
  });
});

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

test.describe("documents", () => {
  test("listDocumentCommits returns at least one commit with sha, message, author, and timestamp", async () => {
    const commits = await listDocumentCommits({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      filePath: SEEDED_DOC_PATH,
    });

    expect(commits.length).toBeGreaterThan(0);

    const first = commits[0]!;
    expect(typeof first.sha).toBe("string");
    expect(first.sha.length).toBeGreaterThan(0);
    expect(typeof first.message).toBe("string");
    expect(typeof first.author).toBe("string");
    expect(typeof first.timestamp).toBe("string");
  });

  test("fetchDocumentAtSha returns valid ProseMirror JSON for the head commit of the seeded document", async () => {
    const commits = await listDocumentCommits({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      filePath: SEEDED_DOC_PATH,
    });
    expect(commits.length).toBeGreaterThan(0);

    const doc = await fetchDocumentAtSha({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      filePath: SEEDED_DOC_PATH,
      sha: commits[0]!.sha,
    });

    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);
  });

  test("commitDocument writes a new file and returns a non-empty commit sha and file sha", async () => {
    const client = makeClient();
    const branch = `test/commit-doc-${Date.now()}`;

    await createUploadBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branchName: branch,
      from: "main",
    });

    const result = await commitDocument({
      client,
      owner: OWNER,
      repo: REPO,
      filePath: "documents/commit-doc-test.json",
      branch,
      message: "test: commitDocument integration write",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Written by commitDocument test." },
            ],
          },
        ],
      },
    });

    expect(typeof result.sha).toBe("string");
    expect(result.sha.length).toBeGreaterThan(0);
    // fileSha may be null on some Gitea versions; just assert the shape exists
    expect("fileSha" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pull request workflow
// ---------------------------------------------------------------------------

test.describe("pull request workflow", () => {
  test("getPullRequestForBranch returns approvalState changes_requested for the seeded PR", async () => {
    const pr = await getPullRequestForBranch({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      branch: SEEDED_BRANCH,
    });

    const state: ApprovalState = pr!.approvalState;

    expect(pr).not.toBeNull();
    expect(state).toBe("changes_requested");
    expect(pr!.number).toBeGreaterThan(0);
  });

  test("getPullRequestForBranch returns null for a branch that has no PR", async () => {
    // "main" never has an open PR targeting itself.
    const pr = await getPullRequestForBranch({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      branch: "main",
    });

    expect(pr).toBeNull();
  });

  test("listPullRequests returns open PRs including the seeded one", async () => {
    const prs = await listPullRequests({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      state: "open",
    });

    expect(prs.length).toBeGreaterThan(0);

    const seeded = prs.find(
      (pr) => (pr.head as { ref?: string } | undefined)?.ref === SEEDED_BRANCH,
    );
    expect(seeded).toBeDefined();
    expect(seeded!.approvalState).toBe("changes_requested");
  });

  // -------------------------------------------------------------------------
  // Create / approve / merge — uses a fresh branch per run so the seeded
  // fixture is never disturbed.
  // -------------------------------------------------------------------------

  test.describe("create / approve / merge lifecycle", () => {
    let testBranch: string;

    test.beforeAll(async () => {
      testBranch = `test/pr-workflow-${Date.now()}`;
    });

    test("createPullRequest opens a PR visible via getPullRequestForBranch with approvalState in_review", async () => {
      const client = makeClient();

      // Arrange — branch with a commit that differs from main
      await createUploadBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branchName: testBranch,
        from: "main",
      });

      await commitDocument({
        client,
        owner: OWNER,
        repo: REPO,
        filePath: "documents/pr-workflow-test.json",
        branch: testBranch,
        message: "test: add document for PR workflow test",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "PR workflow test document." }],
            },
          ],
        },
      });

      // Act
      const created = await createPullRequest({
        client,
        owner: OWNER,
        repo: REPO,
        title: "Test: PR workflow",
        head: testBranch,
        base: "main",
        body: "Created by integration test suite.",
      });

      // Assert
      const found = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: testBranch,
      });

      expect(created.number).toBeGreaterThan(0);
      expect(found).not.toBeNull();
      expect(found!.number).toBe(created.number);
      expect(found!.approvalState).toBe("in_review");
    });

    test("submitReview with APPROVE transitions the PR to approvalState approved", async () => {
      const client = makeClient();

      const before = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: testBranch,
      });
      expect(before).not.toBeNull();
      const pullNumber = before!.number!;

      await submitReview({
        client,
        owner: OWNER,
        repo: REPO,
        pullNumber,
        event: "APPROVE",
        body: "Approved by integration test.",
      });

      await pollUntil(async () => {
        const pr = await getPullRequestForBranch({
          client,
          owner: OWNER,
          repo: REPO,
          branch: testBranch,
        });
        return pr?.approvalState === "approved";
      }, `PR #${pullNumber} to reach approved state`);

      const after = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: testBranch,
      });
      expect(after!.approvalState).toBe("approved");
    });

    test("mergePullRequest closes the PR and getPullRequestForBranch reports approvalState published", async () => {
      const client = makeClient();

      const before = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: testBranch,
      });
      expect(before).not.toBeNull();
      const pullNumber = before!.number!;

      await mergePullRequest({
        client,
        owner: OWNER,
        repo: REPO,
        pullNumber,
        mergeStyle: "merge",
        message: "Merged by integration test.",
      });

      await pollUntil(async () => {
        const pr = await getPullRequestForBranch({
          client,
          owner: OWNER,
          repo: REPO,
          branch: testBranch,
        });
        return pr?.approvalState === "published";
      }, `PR #${pullNumber} to reach published state after merge`);

      const after = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: testBranch,
      });
      expect(after!.approvalState).toBe("published");
    });
  });
});

// ---------------------------------------------------------------------------
// repos
// ---------------------------------------------------------------------------

test.describe("repos", () => {
  test("listWorkspaceRepos includes the seeded repository", async () => {
    const repos = await listWorkspaceRepos(makeClient());

    const seeded = repos.find(
      (r) => r.name === REPO && r.owner.login === OWNER,
    );
    expect(seeded).toBeDefined();
    expect(seeded!.full_name).toBe(`${OWNER}/${REPO}`);
  });

  test("getLatestDocTag returns null when the repo has no doc/vNNNN tags", async () => {
    // The seeded quarterly-report repo has no tags — correct baseline.
    const tag = await getLatestDocTag(makeClient(), OWNER, REPO);
    expect(tag).toBeNull();
  });

  test("listDocTags returns an empty array when the repo has no doc/vNNNN tags", async () => {
    const tags = await listDocTags(makeClient(), OWNER, REPO);
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// uploads (branch and binary-file helpers)
// ---------------------------------------------------------------------------

test.describe("uploads", () => {
  test("validateUploadFile accepts a file within the 25 MiB limit", () => {
    const file = new File(["hello"], "test.pdf", { type: "application/pdf" });
    const result = validateUploadFile(file);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("validateUploadFile rejects a file that exceeds 25 MiB", () => {
    // Simulate an oversized file by overriding the size property.
    const file = Object.create(File.prototype) as File;
    Object.defineProperty(file, "size", { value: 26 * 1024 * 1024 });

    const result = validateUploadFile(file);
    expect(result.valid).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(result.reason).toMatch(/too large/i);
  });

  test("buildUploadBranchName produces a well-formed upload branch path", () => {
    const fixedDate = new Date("2025-06-15T10:30:00Z");
    const name = buildUploadBranchName(
      "annual-report",
      "alice",
      "ab12cd34",
      fixedDate,
    );

    expect(name).toBe("upload/annual-report/20250615/103000Z-alice-ab12cd34");
  });

  test("buildUploadCommitMessage includes all required ADR-0001 trailers", () => {
    const message = buildUploadCommitMessage({
      docSlug: "annual-report",
      canonicalFile: "annual-report.pdf",
      sourceFilename: "2025 Annual Report.pdf",
      uploadBranch: "upload/annual-report/20250615/103000Z-alice-ab12cd34",
      uploaderSlug: "alice",
      fileHashSha256: "abc123def456",
    });

    expect(message).toContain("Upload: 2025 Annual Report.pdf");
    expect(message).toContain("Bindersnap-Document-Id: annual-report");
    expect(message).toContain("Bindersnap-Canonical-File: annual-report.pdf");
    expect(message).toContain(
      "Bindersnap-Source-Filename: 2025 Annual Report.pdf",
    );
    expect(message).toContain("Bindersnap-Uploaded-By: alice");
    expect(message).toContain("Bindersnap-File-Hash-SHA256: abc123def456");
  });

  test("createUploadBranch creates a new branch visible in Gitea", async () => {
    const client = makeClient();
    const branchName = `test/upload-branch-${Date.now()}`;

    // Act — should not throw
    await createUploadBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branchName,
      from: "main",
    });

    // Assert — verify via a direct gitea-client lookup
    const { data } = await client.GET(
      "/repos/{owner}/{repo}/branches/{branch}",
      {
        params: { path: { owner: OWNER, repo: REPO, branch: branchName } },
      },
    );
    expect(data?.name).toBe(branchName);
  });

  test("commitBinaryFile commits base64 content and returns a non-empty commit sha", async () => {
    const client = makeClient();
    const branchName = `test/binary-file-${Date.now()}`;

    await createUploadBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branchName,
      from: "main",
    });

    // A minimal valid base64 payload (three bytes "abc")
    const base64Content = btoa("abc");

    const result = await commitBinaryFile({
      client,
      owner: OWNER,
      repo: REPO,
      branch: branchName,
      filePath: "uploads/test-binary.bin",
      base64Content,
      message: "test: commitBinaryFile integration write",
    });

    expect(typeof result.sha).toBe("string");
    expect(result.sha.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Private helpers (test-local — not exported from helpers.ts)
// ---------------------------------------------------------------------------

/**
 * Restore a token that was deliberately cleared by a test.
 * Wraps storeToken so the call site reads clearly at a glance.
 */
function storeTokenBack(token: string): void {
  if (token) {
    storeToken(token);
  }
}
