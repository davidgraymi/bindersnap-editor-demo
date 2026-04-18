import { expect, test } from "@playwright/test";

test.describe("GitHub Pages static artifact", () => {
  test("renders the landing content from the built HTML shell", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /Your approval process/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load Editor" }),
    ).toBeVisible();
  });

  test("boots the SPA from 404.html for deep links", async ({ page }) => {
    await page.goto("/docs/alice/quarterly-report");

    await expect(page).toHaveURL(/\/docs\/alice\/quarterly-report$/);
    await expect(
      page.getByRole("heading", { name: "Step into the clean version." }),
    ).toBeVisible();
  });
});
