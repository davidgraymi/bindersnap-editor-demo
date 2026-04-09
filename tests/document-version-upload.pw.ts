/**
 * Integration test for uploading new versions to an existing document repo.
 *
 * Tests the fix for the bug where uploading v2+ failed with "repository file
 * already exists" because commitBinaryFile was using POST (create) instead of
 * PUT (update) when the file already existed on the branch (inherited from main).
 *
 * Flow:
 * 1. Seed a v1 file on main (create branch → commit binary → create PR → approve → merge → tag)
 * 2. Upload v2 to a new branch (the critical test — file exists on main, so PUT must be used)
 * 3. Approve the v2 PR
 * 4. Merge/publish and tag as doc/v0002
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import {
  createPullRequest,
  getPullRequestForBranch,
  mergePullRequest,
  submitReview,
} from "../packages/gitea-client/pullRequests";
import {
  createDocTag,
  getLatestDocTag,
} from "../packages/gitea-client/repos";
import {
  commitBinaryFile,
  createUploadBranch,
} from "../packages/gitea-client/uploads";

import {
  createBobClient,
  installMemorySessionStorage,
  makeClient,
  OWNER,
  pollUntil,
  REPO,
  resolveAndStoreToken,
} from "./helpers";

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  installMemorySessionStorage();
  await resolveAndStoreToken("bindersnap-version-upload");
});

// ---------------------------------------------------------------------------
// Document version upload lifecycle
// ---------------------------------------------------------------------------

test.describe("document version upload lifecycle", () => {
  // Use serial mode — each step depends on the prior step's state.
  test.describe.configure({ mode: "serial" });

  let bobClient: Awaited<ReturnType<typeof createBobClient>>;
  let v1Branch: string;
  let v2Branch: string;
  const filePath = "document.txt";

  test.beforeAll(async () => {
    bobClient = await createBobClient();
    v1Branch = `test/version-upload-v1-${Date.now()}`;
    v2Branch = `test/version-upload-v2-${Date.now()}`;
  });

  // Step 1: Seed v1 on main
  test("seed v1: create branch, commit binary file, create PR", async () => {
    const client = makeClient();

    // Create branch for v1
    await createUploadBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branchName: v1Branch,
      from: "main",
    });

    // Commit v1 content
    const v1Content = btoa("v1 content");
    const result = await commitBinaryFile({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
      filePath,
      base64Content: v1Content,
      message: "test: add v1 of document",
    });

    expect(result.sha).toBeTruthy();
    expect(result.sha.length).toBeGreaterThan(0);

    // Create PR
    await createPullRequest({
      client,
      owner: OWNER,
      repo: REPO,
      title: "Test: upload v1",
      head: v1Branch,
      base: "main",
      body: "v1 upload for version upload test.",
    });

    // Verify PR state
    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
    });

    expect(pr).not.toBeNull();
    expect(pr!.approvalState).toBe("in_review");
  });

  test("seed v1: bob approves the PR", async () => {
    const client = makeClient();

    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
    });
    expect(pr).not.toBeNull();
    const pullNumber = pr!.number!;

    await submitReview({
      client: bobClient,
      owner: OWNER,
      repo: REPO,
      pullNumber,
      event: "APPROVE",
      body: "Approved v1 by integration test.",
    });

    await pollUntil(async () => {
      const updated = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: v1Branch,
      });
      return updated?.approvalState === "approved";
    }, `v1 PR #${pullNumber} to reach approved state`);

    const approved = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
    });
    expect(approved!.approvalState).toBe("approved");
  });

  test("seed v1: merge PR and tag as doc/v0001", async () => {
    const client = makeClient();

    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
    });
    expect(pr).not.toBeNull();
    const pullNumber = pr!.number!;

    await mergePullRequest({
      client,
      owner: OWNER,
      repo: REPO,
      pullNumber,
      mergeStyle: "merge",
      message: "Merged v1 by integration test.",
    });

    await pollUntil(async () => {
      const updated = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: v1Branch,
      });
      return updated?.approvalState === "published";
    }, `v1 PR #${pullNumber} to reach published state after merge`);

    const published = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v1Branch,
    });
    expect(published!.approvalState).toBe("published");

    // Tag the merge commit as doc/v0001
    // The merge commit sha is in the PR's merge_commit_sha field
    const { data: prData } = await client.GET(
      "/repos/{owner}/{repo}/pulls/{index}",
      {
        params: { path: { owner: OWNER, repo: REPO, index: pullNumber } },
      },
    );
    const mergeCommitSha = prData?.merge_commit_sha;
    expect(mergeCommitSha).toBeTruthy();

    const tag = await createDocTag({
      client,
      owner: OWNER,
      repo: REPO,
      version: 1,
      target: mergeCommitSha!,
    });

    expect(tag.name).toBe("doc/v0001");
    expect(tag.version).toBe(1);

    // Verify tag via getLatestDocTag
    const latestTag = await getLatestDocTag(client, OWNER, REPO);
    expect(latestTag).not.toBeNull();
    expect(latestTag!.name).toBe("doc/v0001");
  });

  // Step 2: Upload v2 (the critical test)
  test("upload v2: create branch from main and commit NEW version of the file", async () => {
    const client = makeClient();

    // Create branch for v2 from main (which now has the v1 file)
    await createUploadBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branchName: v2Branch,
      from: "main",
    });

    // Critical assertion: commitBinaryFile must succeed when the file already
    // exists on the branch (inherited from main). Before the fix, this threw
    // "repository file already exists" because POST was used instead of PUT.
    const v2Content = btoa("v2 content");
    const result = await commitBinaryFile({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
      filePath, // Same path as v1
      base64Content: v2Content,
      message: "test: update to v2 of document",
    });

    expect(result.sha).toBeTruthy();
    expect(result.sha.length).toBeGreaterThan(0);

    // Create PR
    await createPullRequest({
      client,
      owner: OWNER,
      repo: REPO,
      title: "Test: upload v2",
      head: v2Branch,
      base: "main",
      body: "v2 upload for version upload test.",
    });

    // Verify PR state
    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
    });

    expect(pr).not.toBeNull();
    expect(pr!.approvalState).toBe("in_review");
  });

  // Step 3: Approve v2
  test("upload v2: bob approves the PR", async () => {
    const client = makeClient();

    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
    });
    expect(pr).not.toBeNull();
    const pullNumber = pr!.number!;

    await submitReview({
      client: bobClient,
      owner: OWNER,
      repo: REPO,
      pullNumber,
      event: "APPROVE",
      body: "Approved v2 by integration test.",
    });

    await pollUntil(async () => {
      const updated = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: v2Branch,
      });
      return updated?.approvalState === "approved";
    }, `v2 PR #${pullNumber} to reach approved state`);

    const approved = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
    });
    expect(approved!.approvalState).toBe("approved");
  });

  // Step 4: Merge/publish v2 and tag
  test("upload v2: merge PR and tag as doc/v0002", async () => {
    const client = makeClient();

    const pr = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
    });
    expect(pr).not.toBeNull();
    const pullNumber = pr!.number!;

    await mergePullRequest({
      client,
      owner: OWNER,
      repo: REPO,
      pullNumber,
      mergeStyle: "merge",
      message: "Merged v2 by integration test.",
    });

    await pollUntil(async () => {
      const updated = await getPullRequestForBranch({
        client,
        owner: OWNER,
        repo: REPO,
        branch: v2Branch,
      });
      return updated?.approvalState === "published";
    }, `v2 PR #${pullNumber} to reach published state after merge`);

    const published = await getPullRequestForBranch({
      client,
      owner: OWNER,
      repo: REPO,
      branch: v2Branch,
    });
    expect(published!.approvalState).toBe("published");

    // Tag the merge commit as doc/v0002
    const { data: prData } = await client.GET(
      "/repos/{owner}/{repo}/pulls/{index}",
      {
        params: { path: { owner: OWNER, repo: REPO, index: pullNumber } },
      },
    );
    const mergeCommitSha = prData?.merge_commit_sha;
    expect(mergeCommitSha).toBeTruthy();

    const tag = await createDocTag({
      client,
      owner: OWNER,
      repo: REPO,
      version: 2,
      target: mergeCommitSha!,
    });

    expect(tag.name).toBe("doc/v0002");
    expect(tag.version).toBe(2);

    // Verify tag via getLatestDocTag
    const latestTag = await getLatestDocTag(client, OWNER, REPO);
    expect(latestTag).not.toBeNull();
    expect(latestTag!.name).toBe("doc/v0002");
    expect(latestTag!.version).toBe(2);
  });
});
