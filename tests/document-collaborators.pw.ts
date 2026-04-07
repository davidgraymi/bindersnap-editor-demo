/**
 * Integration coverage for document collaborator management.
 *
 * The test exercises the real browser UI against the local stack:
 * - sign up a fresh workspace owner
 * - create a new document repository
 * - add alice and bob as read collaborators
 * - assert collaborator rows update immediately without a refresh
 * - reload, reopen the document, and verify owner/admin labeling is correct
 */

import { expect, test, type Page } from "@playwright/test";

function buildUniqueCollaboratorTestData() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    username: `collab-owner-${suffix}`,
    email: `collab-owner-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
    fileName: `collaborator-coverage-${suffix}.pdf`,
  };
}

function expectedDocumentName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function signUp(
  page: Page,
  credentials: {
    username: string;
    email: string;
    password: string;
  },
): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Create your Bindersnap workspace.",
    }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByLabel("Confirm Password", { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByText(`Signed in as ${credentials.username}`),
  ).toBeVisible();
}

async function createDocument(page: Page, fileName: string): Promise<void> {
  await expect(
    page.getByRole("button", { name: "New Document" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Document" }).first().click();

  await expect(
    page.getByRole("heading", { name: "Create workspace document" }),
  ).toBeVisible();

  await page.locator("#create-document-file").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from(`Bindersnap collaborator coverage: ${fileName}\n`),
  });

  await expect(page.locator("#create-document-name")).toHaveValue(
    expectedDocumentName(fileName),
  );

  await page.getByRole("button", { name: "Create Document" }).click();

  await expect(
    page.getByRole("button", { name: "← Back to workspace" }),
  ).toBeVisible({ timeout: 120_000 });
}

async function openCollaboratorsTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Collaborators" }).click();
  await expect(
    page.getByRole("heading", { name: "Grant access" }),
  ).toBeVisible();
}

async function addReadCollaborator(page: Page, login: string): Promise<void> {
  const searchLabel = page.getByLabel("Search users by name");
  const searchResult = page
    .locator(".collaborator-search-result")
    .filter({ hasText: `@${login}` });

  await page.locator(".collaborator-default-permission").selectOption("read");
  await searchLabel.fill(login);
  await expect(searchResult).toBeVisible({ timeout: 30_000 });
  await searchResult.getByRole("button", { name: "Add collaborator" }).click();

  await expect(page.locator(".collaborator-row")).toHaveCount(
    login === "alice" ? 1 : 2,
    { timeout: 30_000 },
  );
}

async function reopenDocumentFromWorkspace(page: Page): Promise<void> {
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your Documents" }),
  ).toBeVisible({
    timeout: 120_000,
  });

  await expect(page.locator(".vault-doc-card")).toHaveCount(1, {
    timeout: 120_000,
  });
  await page.locator(".vault-doc-card").first().click();
  await expect(
    page.getByRole("button", { name: "Collaborators" }),
  ).toBeVisible();
  await openCollaboratorsTab(page);
}

test.describe("document collaborator management", () => {
  test.describe.configure({ timeout: 120_000 });

  test("adds read collaborators immediately and keeps owner out of the list", async ({
    page,
  }) => {
    const credentials = buildUniqueCollaboratorTestData();

    await signUp(page, credentials);
    await createDocument(page, credentials.fileName);
    await openCollaboratorsTab(page);

    await expect(page.locator(".collaborator-row")).toHaveCount(0);

    await addReadCollaborator(page, "alice");
    await expect(page.locator(".collaborator-row")).toHaveCount(1);
    await expect(
      page.locator(".collaborator-row").filter({ hasText: "@alice" }),
    ).toContainText("Read");
    await expect(
      page.locator(".collaborator-row").filter({ hasText: "Owner" }),
    ).toHaveCount(0);

    await addReadCollaborator(page, "bob");
    await expect(page.locator(".collaborator-row")).toHaveCount(2);
    await expect(
      page.locator(".collaborator-row").filter({ hasText: "@bob" }),
    ).toContainText("Read");
    await expect(
      page.locator(".collaborator-row").filter({ hasText: "Owner" }),
    ).toHaveCount(0);

    await reopenDocumentFromWorkspace(page);

    await expect(
      page.locator(".collaborators-table .collaborator-row").filter({
        hasText: credentials.username,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator(".collaborators-table .collaborator-row").filter({
        hasText: "@alice",
      }),
    ).toContainText("Read");
    await expect(
      page.locator(".collaborators-table .collaborator-row").filter({
        hasText: "@bob",
      }),
    ).toContainText("Read");
    await expect(
      page.locator(".collaborators-table .collaborator-row").filter({
        hasText: "Owner",
      }),
    ).toHaveCount(0);
  });
});
