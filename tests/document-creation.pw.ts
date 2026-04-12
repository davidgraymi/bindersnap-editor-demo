/**
 * End-to-end coverage for the UI-driven document creation flow.
 *
 * Signs in as bob through the app, creates a new document from the workspace
 * modal, and verifies the new repo opens in the document detail view with an
 * unpublished v1 and an open review PR.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  buildUniqueDocumentMetadata,
  expectedPrefilledDocumentName,
  openNewDocumentModal,
  signInAsBob,
} from "./helpers";

test.describe("UI document creation flow", () => {
  test.describe.configure({ timeout: 10_000 });

  test("creates a new document as bob and leaves version 1 in review", async ({
    page,
  }) => {
    const doc = buildUniqueDocumentMetadata();
    const fileData = Buffer.from(
      `Bindersnap UI document creation test: ${doc.fileName}\n`,
    );

    await signInAsBob(page);
    await openNewDocumentModal(page);

    await page.locator("#create-document-file").setInputFiles({
      name: doc.fileName,
      mimeType: "application/pdf",
      buffer: fileData,
    });

    await expect(page.locator("#create-document-name")).toHaveValue(
      expectedPrefilledDocumentName(doc.fileName),
    );

    await page.getByRole("button", { name: "Create Document" }).click();

    // New UI uses breadcrumb navigation instead of a back button
    await expect(
      page.locator("nav[aria-label='Breadcrumb'] button", {
        hasText: "Documents",
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /No approved version yet/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /1 Pending Approval/i }),
    ).toBeVisible();
  });
});
