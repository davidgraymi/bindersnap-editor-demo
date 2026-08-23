import { expect, test } from "@playwright/test";

import { signInAsBob } from "./helpers";

test.describe("top nav new document button", () => {
  test("opens the create-document modal from the documents page", async ({
    page,
  }) => {
    await signInAsBob(page);

    await page.locator(".app-topnav-link", { hasText: "Documents" }).click();
    await expect(page.locator(".docs-page")).toBeVisible();

    // Subtle by design: the nav's create action is an icon with an accessible
    // name, not a coral button competing with the page's own primary action.
    const newDocButton = page.locator("#topnav-new-doc-btn");
    await expect(newDocButton).toBeVisible();
    await expect(newDocButton).toHaveAccessibleName("New document");
    await expect(newDocButton).toHaveText("");
    await newDocButton.click();

    await expect(
      page.getByRole("heading", { name: "Create workspace document" }),
    ).toBeVisible();
    await expect(page.locator("#create-document-file")).toBeVisible();
  });
});
