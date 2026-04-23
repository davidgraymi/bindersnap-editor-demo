import { expect, test } from "@playwright/test";

import { signInAsBob } from "./helpers";

test.describe("top nav new document button", () => {
  test("opens the create-document modal from the documents page", async ({
    page,
  }) => {
    await signInAsBob(page);

    await page.getByRole("button", { name: "Documents" }).click();
    await expect(
      page.getByRole("heading", { name: "Documents", exact: true }),
    ).toBeVisible();

    await expect(page.locator("#topnav-new-doc-btn")).toBeVisible();
    await page.locator("#topnav-new-doc-btn").click();

    await expect(
      page.getByRole("heading", { name: "Create workspace document" }),
    ).toBeVisible();
    await expect(page.locator("#create-document-file")).toBeVisible();
  });
});
