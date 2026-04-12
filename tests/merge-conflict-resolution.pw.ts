/**
 * Integration test for automatic merge conflict resolution when publishing.
 *
 * Verifies that when a PR has merge conflicts (because main advanced after
 * the upload branch was created), clicking Publish automatically resolves
 * the conflict by rebasing the upload branch onto current main.
 *
 * Flow:
 * 1. Alice creates a new document (uploads v1, PR created)
 * 2. Alice adds Bob as a collaborator via UI
 * 3. Bob approves v1 via UI
 * 4. Alice publishes v1 (PR merged, tag created)
 * 5. Alice uploads v2 and v3 while v2 PR is still open
 * 6. Bob approves v2 via UI
 * 7. Alice publishes v2 — main now has v2, creating a conflict for v3's branch
 * 8. Bob approves v3 via UI
 * 9. Alice clicks Publish for v3 — merge conflict is resolved automatically
 * 10. Verify v3 is published successfully with full version history
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import {
  GITEA_BOB_USER,
  installMemorySessionStorage,
  navigateToDocument,
  openCollaboratorsTab,
  resolveAndStoreToken,
  signInAsAlice,
  signInAsBob,
} from "./helpers";

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

    // Add Bob as a collaborator via UI
    await openCollaboratorsTab(page);
    await page.locator("#collaborator-search").fill(GITEA_BOB_USER);

    // Wait for Bob's result to appear in the search dropdown
    const bobResult = page.locator(".collaborator-search-result", {
      hasText: GITEA_BOB_USER,
    });
    await expect(bobResult).toBeVisible({ timeout: 15_000 });

    // Set write permission and submit
    await bobResult
      .locator(".collaborator-permission-select")
      .selectOption("write");
    await bobResult.getByRole("button", { name: "Add collaborator" }).click();

    // Wait for Bob to appear in the collaborators table confirming success
    await expect(
      page.locator(".collaborator-row", { hasText: GITEA_BOB_USER }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Switch to Bob to approve v1
    await signInAsBob(page);
    await navigateToDocument(page, cardSearchText);

    // Bob approves v1
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Approve" }).click();

    // Wait for the approval status badge to reflect approval
    await expect(page.locator(".vault-status-approved")).toBeVisible({
      timeout: 30_000,
    });

    // Switch back to Alice to publish v1
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

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

  test("upload v2 and v3, publish v2, then publish conflicting v3", async ({
    page,
  }) => {
    expect(repo).toBeTruthy();

    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    // --- Upload v2 (branch-1) ---
    await page.getByRole("button", { name: "Upload New Version" }).click();
    await expect(
      page.getByRole("heading", { name: "Upload Document" }),
    ).toBeVisible();

    await page.locator("#file-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Version 2 content\n"),
    });

    await page
      .locator(".upload-modal")
      .getByRole("button", { name: "Upload" })
      .click();

    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible({ timeout: 60_000 });

    // --- Upload v3 (branch-2) while v2 PR is still open ---
    await page.getByRole("button", { name: "Upload New Version" }).click();
    await expect(
      page.getByRole("heading", { name: "Upload Document" }),
    ).toBeVisible();

    await page.locator("#file-upload").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Version 3 content\n"),
    });

    await page
      .locator(".upload-modal")
      .getByRole("button", { name: "Upload" })
      .click();

    await expect(
      page.getByRole("heading", { name: /2 Open Pull Request/ }),
    ).toBeVisible({ timeout: 60_000 });

    // --- Bob approves v2 via UI ---
    // Both PRs have the same "Upload v2:" title because version numbering is
    // based on published tags only — since neither is published yet, both get
    // "Upload v2:". Use position-based selection instead: Gitea returns PRs
    // newest-first (descending by PR number), so .last() is the older PR
    // (lower PR number, created first). We approve the older PR first so it
    // can be published cleanly before the newer PR creates a conflict.
    await signInAsBob(page);
    await navigateToDocument(page, cardSearchText);

    await expect(page.locator(".vault-pr-item")).toHaveCount(2, {
      timeout: 30_000,
    });
    const firstPr = page.locator(".vault-pr-item").last();
    await firstPr.getByRole("button", { name: "Approve" }).click();
    await expect(firstPr.locator(".vault-status-approved")).toBeVisible({
      timeout: 30_000,
    });

    // --- Alice publishes v2 ---
    // Only v2 is approved, so there is exactly one Publish button.
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Publish" }).click();

    // Wait for v2 to be published — PR count drops to 1
    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible({ timeout: 120_000 });

    await expect(
      page.getByRole("heading", { name: "Version 2" }),
    ).toBeVisible();

    // --- Bob approves v3 via UI ---
    // v3's branch was created from old main, but main now has v2's changes,
    // so this PR has a merge conflict that must be resolved on publish.
    // After publishing the first PR there is exactly 1 PR remaining.
    await signInAsBob(page);
    await navigateToDocument(page, cardSearchText);

    await expect(page.locator(".vault-pr-item")).toHaveCount(1, {
      timeout: 30_000,
    });
    const secondPr = page.locator(".vault-pr-item");
    await secondPr.getByRole("button", { name: "Approve" }).click();
    await expect(secondPr.locator(".vault-status-approved")).toBeVisible({
      timeout: 30_000,
    });

    // --- Alice publishes v3 (conflict resolution path) ---
    await signInAsAlice(page);
    await navigateToDocument(page, cardSearchText);

    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({
      timeout: 30_000,
    });

    // Conflict resolution + retry may take longer than a normal merge
    await page.getByRole("button", { name: "Publish" }).click();

    await expect(
      page.getByRole("heading", { name: "No pending reviews" }),
    ).toBeVisible({ timeout: 120_000 });

    // Should now show Version 3 as current
    await expect(
      page.getByRole("heading", { name: "Version 3" }),
    ).toBeVisible();

    // Version history should show all three versions
    await expect(
      page.locator(".vault-version-badge", { hasText: "v3" }),
    ).toBeVisible();
    await expect(
      page.locator(".vault-version-badge", { hasText: "v2" }),
    ).toBeVisible();
    await expect(
      page.locator(".vault-version-badge", { hasText: "v1" }),
    ).toBeVisible();
  });
});
