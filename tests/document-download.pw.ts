/**
 * Browser-based integration test for document download functionality.
 *
 * Tests the complete create → approve → publish → download flow, exercising
 * the "Download Current Version" button and the per-version "Download vN"
 * buttons in the version history section.
 *
 * Flow:
 * 1. Alice creates a new document (v1 uploaded as part of creation)
 * 2. Bob approves v1 via API; Alice publishes v1 via UI
 * 3. Alice downloads the current version — verifies filename is {repo-name}.txt
 * 4. Alice uploads v2 via the "Upload New Version" button
 * 5. Bob approves v2 via API; Alice publishes v2 via UI
 * 6. Alice downloads the current version (v2) — verifies filename
 * 7. Alice downloads v1 from the version history — verifies filename
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import {
  getPullRequestForBranch,
  listPullRequests,
  submitReview,
} from "../packages/gitea-client/pullRequests";
import {
  createBobClient,
  expectedPrefilledDocumentName,
  installMemorySessionStorage,
  makeClient,
  navigateToDocument,
  openNewDocumentModal,
  pollUntil,
  resolveAndStoreToken,
  signInAsAlice,
  waitForNoPendingReviews,
} from "./helpers";

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  installMemorySessionStorage();
  await resolveAndStoreToken("bindersnap-download-test");
});

// ---------------------------------------------------------------------------
// Document download flow
// ---------------------------------------------------------------------------

test.describe("Document download", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  const timestamp = Date.now();
  const randomString = Math.random().toString(36).slice(2, 8);
  const suffix = `${timestamp}-${randomString}`;
  const fileName = `download-test-${suffix}.txt`;

  // The unique suffix portion (no dashes) is used to find the document card in
  // the workspace, matching the title-cased formatted card text.
  const cardSearchText = randomString;

  // Shared state across serial tests — populated during the first test.
  let owner = "";
  let repo = "";

  test("create document and upload v1", async ({ page }) => {
    const fileData = Buffer.from("Version 1 content for download test\n");

    await signInAsAlice(page);
    await openNewDocumentModal(page);

    // Upload the v1 file
    await page.locator("#create-document-file").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    await expect(page.locator("#create-document-name")).toHaveValue(
      expectedPrefilledDocumentName(fileName),
    );

    // Submit the create form
    await page.getByRole("button", { name: "Create Document" }).click();

    // Wait for navigation to document detail
    await expect(page.locator(".vault-detail")).toBeVisible({ timeout: 10_000 });

    // Verify the document is in the unpublished state with 1 pending approval
    await expect(
      page.getByRole("heading", { name: /No approved version yet/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /1 Pending Approval/i }),
    ).toBeVisible();

    // Capture the repo owner and name from the URL for subsequent API calls
    const url = page.url();
    const urlParts = url.replace(/.*\/docs\//, "").split("/");
    owner = urlParts[0] ?? "";
    repo = urlParts[1] ?? "";
    expect(owner).toBeTruthy();
    expect(repo).toBeTruthy();
  });

  test("bob approves v1 and alice publishes", async ({ page }) => {
    expect(repo).toBeTruthy();

    // Add bob as a collaborator so he can review (repo is private by default)
    const client = makeClient();
    await client.PUT("/repos/{owner}/{repo}/collaborators/{collaborator}", {
      params: {
        path: { owner, repo, collaborator: "bob" },
      },
      body: { permission: "write" },
    });

    // Find the single open PR and have bob approve it via API
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
      body: "Approved v1 by download integration test.",
    });

    // Wait for Gitea to index the approval before proceeding in the UI
    await pollUntil(async () => {
      const pr = await getPullRequestForBranch({
        client,
        owner,
        repo,
        branch: prs[0]!.head!.ref!,
      });
      return pr?.approvalState === "approved";
    }, "v1 PR approval to be indexed");

    // Sign in as alice and navigate to the document
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // The Publish button must appear now that the PR is approved
    await expect(
      page.getByRole("button", {
        name: "Publish as Official Version",
        exact: true,
      }),
    ).toBeVisible({
      timeout: 30_000,
    });

    // Publish v1
    await page
      .getByRole("button", { name: "Publish as Official Version", exact: true })
      .click();

    await waitForNoPendingReviews(page, cardSearchText);
    await page
      .locator(".app-topnav-link", { hasText: "Documents" })
      .click();
    await navigateToDocument(page, cardSearchText);

    // The page should now report Version 1 as the current published version
    await expect(page.getByRole("heading", { name: "Version 1" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("download current version after v1 publish", async ({ page }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Wait for the v1 published state to render before attempting download
    await expect(page.getByRole("heading", { name: "Version 1" })).toBeVisible({
      timeout: 30_000,
    });

    // Intercept the download triggered by clicking "Download Current Version"
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Current Version" }).click(),
    ]);

    // The suggested filename must be {repo-name}.txt
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${repo}\\.txt$`));
  });

  test("alice uploads v2 via UI", async ({ page }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Confirm we are on the v1 published state before uploading v2
    await expect(page.getByRole("heading", { name: "Version 1" })).toBeVisible({
      timeout: 30_000,
    });

    // Open the Submit New Version modal (button label changed in new UI)
    await page.getByRole("button", { name: "Submit New Version" }).click();
    await expect(
      page.getByRole("heading", { name: "Upload Document" }),
    ).toBeVisible();

    // Provide the v2 file — same extension (.txt) as v1
    const fileData = Buffer.from("Version 2 content for download test\n");
    await page.locator("#file-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: fileData,
    });

    // Submit the upload form
    await page
      .locator(".upload-modal")
      .getByRole("button", { name: "Upload" })
      .click();

    // Wait for the PR to appear on the document detail page
    await expect(
      page.getByRole("heading", { name: /1 Pending Approval/i }),
    ).toBeVisible({ timeout: 60_000 });

    // The current published version remains v1 until the PR is merged
    await expect(
      page.getByRole("heading", { name: "Version 1" }),
    ).toBeVisible();
  });

  test("bob approves v2 and alice publishes", async ({ page }) => {
    expect(repo).toBeTruthy();

    // Find the open v2 PR via API and have bob approve it
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
      body: "Approved v2 by download integration test.",
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

    // Publish v2
    await expect(
      page.getByRole("button", {
        name: "Publish as Official Version",
        exact: true,
      }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: "Publish as Official Version", exact: true })
      .click();

    await waitForNoPendingReviews(page, cardSearchText);
    await page
      .locator(".app-topnav-link", { hasText: "Documents" })
      .click();
    await navigateToDocument(page, cardSearchText);

    // Version 2 should now be the current published version
    await expect(
      page.getByRole("heading", { name: "Version 2" }),
    ).toBeVisible();

    // Version history must list both published versions
    await expect(
      page.locator(".vault-version-badge", { hasText: "v2" }),
    ).toBeVisible();
    await expect(
      page.locator(".vault-version-badge", { hasText: "v1" }),
    ).toBeVisible();
  });

  test("download current version (v2)", async ({ page }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Wait for the v2 published state to render
    await expect(page.getByRole("heading", { name: "Version 2" })).toBeVisible({
      timeout: 30_000,
    });

    // Intercept the download triggered by "Download Current Version"
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Current Version" }).click(),
    ]);

    // The filename must still be {repo-name}.txt for v2
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${repo}\\.txt$`));
  });

  test("download v1 from version history", async ({ page }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // Wait for the version history section to render the v1 badge
    await expect(
      page.locator(".vault-version-badge", { hasText: "v1" }),
    ).toBeVisible({ timeout: 30_000 });

    // Intercept the download triggered by the "Download v1" history button
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download v1" }).click(),
    ]);

    // The v1 history download filename must also match {repo-name}.txt
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${repo}\\.txt$`));
  });
});
