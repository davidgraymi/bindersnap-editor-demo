import { expect, test } from "@playwright/test";

import { openTopnavNewDocumentModal, signInAsAlice } from "./helpers";

test.describe("topnav new document button", () => {
  test("opens the create-document modal from the inbox route", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.goto("/inbox");

    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    await openTopnavNewDocumentModal(page);

    await expect(page.locator(".create-document-modal")).toBeVisible();
  });
});
