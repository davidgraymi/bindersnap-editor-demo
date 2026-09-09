import { expect, test } from "@playwright/test";

import { openTopnavNewDocumentModal, signInAsAlice } from "./helpers";

test.describe("topnav new policy button", () => {
  test("opens the add-a-policy modal from Home", async ({ page }) => {
    await signInAsAlice(page);
    await page.goto("/");

    await expect(page.locator(".home-greeting")).toBeVisible();

    await openTopnavNewDocumentModal(page);

    await expect(page.locator("#add-policy-file")).toBeVisible();
  });

  test("the retired /inbox link lands on Home", async ({ page }) => {
    await signInAsAlice(page);
    await page.goto("/inbox");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".home-greeting")).toBeVisible();
  });
});
