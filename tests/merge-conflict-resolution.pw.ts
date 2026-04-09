/**
 * Integration test for automatic merge conflict resolution when publishing.
 *
 * Verifies that when a PR has merge conflicts (because main advanced after
 * the upload branch was created), clicking Publish automatically resolves
 * the conflict by rebasing the upload branch onto current main.
 *
 * Flow:
 * 1. Alice creates a new document (uploads v1, PR created)
 * 2. Bob approves v1
 * 3. Alice publishes v1 (PR merged, tag created)
 * 4. Alice uploads v2 (new PR created from current main)
 * 5. Alice directly commits to main via API to create a divergence
 * 6. Bob approves v2
 * 7. Alice clicks Publish — merge conflicts are resolved automatically
 * 8. Verify v2 is published successfully
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  getPullRequestForBranch,
  listPullRequests,
  submitReview,
} from "../packages/gitea-client/pullRequests";
import {
  createBobClient,
  GITEA_ADMIN_PASS,
  GITEA_ADMIN_USER,
  installMemorySessionStorage,
  makeClient,
  pollUntil,
  resolveAndStoreToken,
} from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signInAsAlice(page: Page): Promise<void> {
  await page.goto("/app");

  // If already signed in (token persisted), we land on the workspace directly.
  // Otherwise we need to go through the login flow.
  const alreadySignedIn = await page
    .getByText(`Signed in as ${GITEA_ADMIN_USER}`)
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (alreadySignedIn) {
    return;
  }

  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Step into the clean version." }),
  ).toBeVisible();

  await page.getByLabel("Username or Email").fill(GITEA_ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(GITEA_ADMIN_PASS);
  await page.getByRole("button", { name: "Open workspace" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByText(`Signed in as ${GITEA_ADMIN_USER}`),
  ).toBeVisible();
}

async function navigateToDocument(page: Page, docName: string): Promise<void> {
  const card = page.locator(".vault-doc-card", { hasText: docName });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(
    page.getByRole("button", { name: "← Back to workspace" }),
  ).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  installMemorySessionStorage();
  await resolveAndStoreToken("bindersnap-merge-conflict");
});

// ---------------------------------------------------------------------------
// Merge conflict resolution test
// ---------------------------------------------------------------------------

test.describe("Merge conflict resolution on publish", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  const timestamp = Date.now();
  const randomString = Math.random().toString(36).slice(2, 8);
  const suffix = `${timestamp}-${randomString}`;
  const fileName = `conflict-test-${suffix}.txt`;
  const cardSearchText = randomString;

  let owner = "";
  let repo = "";

  test("create document and publish v1", async ({ page }) => {
    const fileData = Buffer.from("Version 1 content\n");

    await signInAsAlice(page);

    // Create the document
    await page.getByRole("button", { name: "New Document" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Create workspace document" }),
    ).toBeVisible();

    await page.locator("#create-document-file").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    await expect(page.locator("#create-document-name")).not.toHaveValue("");
    await page.getByRole("button", { name: "Create Document" }).click();

    await expect(
      page.getByRole("button", { name: "← Back to workspace" }),
    ).toBeVisible({ timeout: 10_000 });

    // Capture repo info
    const repoPathText =
      (await page.locator(".vault-repo-path").textContent()) ?? "";
    const parts = repoPathText.trim().split("/");
    owner = parts[0] ?? "";
    repo = parts[1] ?? "";
    expect(owner).toBeTruthy();
    expect(repo).toBeTruthy();

    // Bob approves v1
    const client = makeClient();
    await client.PUT("/repos/{owner}/{repo}/collaborators/{collaborator}", {
      params: {
        path: { owner, repo, collaborator: "bob" },
      },
      body: { permission: "write" },
    });

    const prs = await listPullRequests({
      client,
      owner,
      repo,
      state: "open",
    });
    expect(prs.length).toBe(1);
    const prNumber = prs[0]!.number!;

    const bobClient = await createBobClient();
    await submitReview({
      client: bobClient,
      owner,
      repo,
      pullNumber: prNumber,
      event: "APPROVE",
      body: "Approved v1.",
    });

    await pollUntil(async () => {
      const pr = await getPullRequestForBranch({
        client,
        owner,
        repo,
        branch: prs[0]!.head!.ref!,
      });
      return pr?.approvalState === "approved";
    }, "v1 PR approval to be indexed");

    // Navigate back to pick up the approval state
    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await navigateToDocument(page, cardSearchText);

    // Publish v1
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(
      page.getByRole("heading", { name: "No pending reviews" }),
    ).toBeVisible({ timeout: 120_000 });

    await expect(
      page.getByRole("heading", { name: "Version 1" }),
    ).toBeVisible();
  });

  test("upload v2, create conflict on main, then publish successfully", async ({
    page,
  }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Upload v2
    await page.getByRole("button", { name: "Upload New Version" }).click();
    await expect(
      page.getByRole("heading", { name: "Upload Document" }),
    ).toBeVisible();

    const fileData = Buffer.from("Version 2 content with updates\n");
    await page.locator("#file-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    await page
      .locator(".upload-modal")
      .getByRole("button", { name: "Upload" })
      .click();

    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible({ timeout: 60_000 });

    // Now create a conflict: directly modify the file on main via API.
    // This simulates the scenario where main has advanced (e.g. another
    // version was published) after the upload branch was created.
    const client = makeClient();

    // Find the canonical file on main
    const mainContents = await client.GET(
      "/repos/{owner}/{repo}/contents/{filepath}",
      {
        params: {
          path: { owner, repo, filepath: "." },
          query: { ref: "main" },
        },
      },
    );
    const entries = (mainContents.data ?? []) as Array<{
      name: string;
      type: string;
      path: string;
    }>;
    const docFile = entries.find(
      (e) =>
        e.type === "file" &&
        !e.name.startsWith(".") &&
        e.name !== "README.md",
    );
    expect(docFile).toBeTruthy();

    // Get the current file SHA on main
    const currentFile = await client.GET(
      "/repos/{owner}/{repo}/contents/{filepath}",
      {
        params: {
          path: { owner, repo, filepath: docFile!.path },
          query: { ref: "main" },
        },
      },
    );
    const currentSha = (currentFile.data as { sha?: string })?.sha;
    expect(currentSha).toBeTruthy();

    // Commit a different version directly to main to create a conflict
    const conflictContent = Buffer.from(
      "Conflicting content committed directly to main\n",
    ).toString("base64");
    await client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
      params: { path: { owner, repo, filepath: docFile!.path } },
      body: {
        content: conflictContent,
        message: "Direct commit to main to create merge conflict",
        branch: "main",
        sha: currentSha!,
      },
    });

    // Bob approves v2
    const prs = await listPullRequests({
      client,
      owner,
      repo,
      state: "open",
    });
    expect(prs.length).toBe(1);
    const prNumber = prs[0]!.number!;

    const bobClient = await createBobClient();
    await submitReview({
      client: bobClient,
      owner,
      repo,
      pullNumber: prNumber,
      event: "APPROVE",
      body: "Approved v2.",
    });

    await pollUntil(async () => {
      const pr = await getPullRequestForBranch({
        client,
        owner,
        repo,
        branch: prs[0]!.head!.ref!,
      });
      return pr?.approvalState === "approved";
    }, "v2 PR approval to be indexed");

    // Navigate back to pick up the approval state
    await page.getByRole("button", { name: "← Back to workspace" }).click();
    await navigateToDocument(page, cardSearchText);

    // The Publish button should appear (PR is approved)
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });

    // Click Publish — this will hit a merge conflict, which should be
    // automatically resolved by the conflict resolution logic
    await page.getByRole("button", { name: "Publish" }).click();

    // Wait for publish to complete — the conflict resolution + retry
    // may take longer than a normal merge
    await expect(
      page.getByRole("heading", { name: "No pending reviews" }),
    ).toBeVisible({ timeout: 120_000 });

    // Should now show Version 2 as current
    await expect(
      page.getByRole("heading", { name: "Version 2" }),
    ).toBeVisible();

    // Version history should show both versions
    await expect(
      page.locator(".vault-version-badge", { hasText: "v2" }),
    ).toBeVisible();
    await expect(
      page.locator(".vault-version-badge", { hasText: "v1" }),
    ).toBeVisible();
  });
});
