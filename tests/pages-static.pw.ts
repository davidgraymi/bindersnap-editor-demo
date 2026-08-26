import { expect, test } from "@playwright/test";

test.describe("GitHub Pages static artifact", () => {
  test("renders the landing content from the built HTML shell", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /which version you approved/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create Your Account/i }).first(),
    ).toBeVisible();
  });

  test("boots the SPA from 404.html for deep links", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Step into the clean version." }),
    ).toBeVisible();
  });
});
