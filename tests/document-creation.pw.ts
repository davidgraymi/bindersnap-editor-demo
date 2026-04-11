/**
 * End-to-end coverage for the UI-driven document creation flow.
 *
 * Signs in as bob through the app, creates a new document from the workspace
 * modal, and verifies the new repo opens in the document detail view with an
 * unpublished v1 and an open review PR.
 */

import { expect, test, type Page } from "@playwright/test";

import { signInAsBob } from "./helpers";

function buildUniqueDocumentMetadata() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    fileName: `ui-document-creation-${suffix}.pdf`,
  };
}

function expectedPrefilledDocumentName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function openNewDocumentModal(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "New Document" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Document" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Create workspace document" }),
  ).toBeVisible();
}

test.describe("UI document creation flow", () => {
  test.describe.configure({ timeout: 60_000 });

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

    await expect(
      page.getByRole("button", { name: "← Back to workspace" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "Unpublished" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("No published version exists yet."),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /1 Open Pull Request/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Upload v1:/)).toBeVisible({ timeout: 10_000 });
  });
});
