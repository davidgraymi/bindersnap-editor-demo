import { expect, test } from "@playwright/test";

import { openTopnavNewDocumentModal, signInAsAlice } from "./helpers";

// A browser test that signs in, navigates and waits on the network does not
// fit the suite-wide 10s budget on a loaded runner — it passes alone in ~7s,
// which leaves nothing spare. Same treatment every other heavy file here
// already gets.
test.describe.configure({ timeout: 60_000 });

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
