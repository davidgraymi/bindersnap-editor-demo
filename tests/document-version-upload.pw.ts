/**
 * Browser-based integration test for uploading multiple versions of a document.
 *
 * Tests the complete upload → approve → merge flow for both v1 and v2 of a
 * document, exercising the actual UI that users interact with.
 *
 * Flow:
 * 1. Alice signs in, creates a new document (v1 uploaded as part of creation)
 * 2. Bob approves v1 via API (can't sign in as two users simultaneously)
 * 3. Alice publishes v1 through the UI
 * 4. Alice uploads v2 via the "Upload New Version" button
 * 5. Bob approves v2 via API
 * 6. Alice publishes v2 through the UI
 * 7. Verify the page shows v2 as the latest version
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

/**
 * Navigate from the workspace to a document detail page by clicking its card.
 */
async function navigateToDocument(page: Page, docName: string): Promise<void> {
  // Wait for the card to appear (workspace may still be loading)
  const card = page.locator(".vault-doc-card", { hasText: docName });
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Click the card
  await card.click();

  // Wait for the detail view to load
  await expect(
    page.getByRole("button", { name: "← Back to workspace" }),
  ).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  installMemorySessionStorage();
  await resolveAndStoreToken("bindersnap-version-upload-ui");
});

// ---------------------------------------------------------------------------
// Browser-based document version upload flow
// ---------------------------------------------------------------------------

test.describe("UI document version upload flow", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const timestamp = Date.now();
  const randomString = Math.random().toString(36).slice(2, 8);
  const suffix = `${timestamp}-${randomString}`;
  const fileName = `version-upload-test-${suffix}.txt`;

  // The unique suffix is used to find the document card in the workspace.
  // formatDocumentName title-cases dashes, so "version-upload-test-abc123"
  // becomes "Version Upload Test Abc123". We search for the random string
  // portion (no dashes) so it matches the formatted card text.
  const cardSearchText = randomString;

  // Shared state across serial tests — set during the first test.
  let owner = "";
  let repo = "";

  test("create new document and upload v1", async ({ page }) => {
    const fileData = Buffer.from("Version 1 content\n");

    await signInAsAlice(page);

    // Open the create document modal
    await page.getByRole("button", { name: "New Document" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Create workspace document" }),
    ).toBeVisible();

    // Upload file
    await page.locator("#create-document-file").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    // Wait for name to auto-fill
    await expect(page.locator("#create-document-name")).not.toHaveValue("");

    // Create the document
    await page.getByRole("button", { name: "Create Document" }).click();

    // Wait for navigation to document detail
    await expect(
      page.getByRole("button", { name: "← Back to workspace" }),
    ).toBeVisible({ timeout: 10_000 });

    // Verify unpublished state
    await expect(
      page.getByRole("heading", { name: "Unpublished" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible();
    await expect(page.getByText(/Upload v1:/)).toBeVisible();

    // Capture repo info from the page
    const repoPathText =
      (await page.locator(".vault-repo-path").textContent()) ?? "";
    const parts = repoPathText.trim().split("/");
    owner = parts[0] ?? "";
    repo = parts[1] ?? "";
    expect(owner).toBeTruthy();
    expect(repo).toBeTruthy();
  });

  test("bob approves v1 and alice publishes", async ({ page }) => {
    expect(repo).toBeTruthy();

    // Add bob as a collaborator so he can review (repo is private)
    const client = makeClient();
    await client.PUT("/repos/{owner}/{repo}/collaborators/{collaborator}", {
      params: {
        path: { owner, repo, collaborator: "bob" },
      },
      body: { permission: "write" },
    });

    // Find the open PR via API and have bob approve it
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
      body: "Approved v1 by integration test.",
    });

    // Wait for Gitea to index the approval
    await pollUntil(async () => {
      const pr = await getPullRequestForBranch({
        client,
        owner,
        repo,
        branch: prs[0]!.head!.ref!,
      });
      return pr?.approvalState === "approved";
    }, "v1 PR approval to be indexed");

    // Now sign in and navigate to the document
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // The Publish button should be visible (PR is approved and alice can merge)
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });

    // Click Publish
    await page.getByRole("button", { name: "Publish" }).click();

    // Wait for publish to complete — pending reviews section shows "No pending reviews"
    // The merge can take longer on second run due to Gitea indexing
    await expect(
      page.getByRole("heading", { name: "No pending reviews" }),
    ).toBeVisible({ timeout: 120_000 });

    // Should now show Version 1
    await expect(
      page.getByRole("heading", { name: "Version 1" }),
    ).toBeVisible();
  });

  test("alice uploads v2 via the UI", async ({ page }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Should show Version 1 as current
    await expect(page.getByRole("heading", { name: "Version 1" })).toBeVisible({
      timeout: 30_000,
    });

    // Click Upload New Version
    await page.getByRole("button", { name: "Upload New Version" }).click();

    // Wait for modal
    await expect(
      page.getByRole("heading", { name: "Upload Document" }),
    ).toBeVisible();

    // Select a file — same extension (.txt) as v1
    const fileData = Buffer.from("Version 2 content with updates\n");
    await page.locator("#file-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    // Click Upload
    await page
      .locator(".upload-modal")
      .getByRole("button", { name: "Upload" })
      .click();

    // Wait for the upload to complete — the modal shows PR creation success
    // then auto-closes. Wait for the PR to appear in the document detail.
    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible({ timeout: 60_000 });

    // Current version should still be v1
    await expect(
      page.getByRole("heading", { name: "Version 1" }),
    ).toBeVisible();
  });

  test("bob approves v2 and alice publishes", async ({ page }) => {
    expect(repo).toBeTruthy();

    // Find the open PR via API and have bob approve it
    const client = makeClient();
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
      body: "Approved v2 by integration test.",
    });

    // Wait for Gitea to index the approval
    await pollUntil(async () => {
      const pr = await getPullRequestForBranch({
        client,
        owner,
        repo,
        branch: prs[0]!.head!.ref!,
      });
      return pr?.approvalState === "approved";
    }, "v2 PR approval to be indexed");

    // Sign in and navigate to the document
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Publish
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Publish" }).click();

    // Wait for publish to complete
    // The merge can take longer on second run due to Gitea indexing
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
