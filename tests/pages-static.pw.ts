import { expect, test } from "@playwright/test";

import { APP_BASE_URL, SITE_BASE_URL } from "./helpers";

/**
 * Two origins (issue #718): the public site, bindersnap.com, and the app,
 * app.bindersnap.com. The local stack serves them on SITE_PORT and APP_PORT.
 */
test.describe("the site and the app", () => {
  test("the site's home is the landing page, and its links lead to the app", async ({
    page,
  }) => {
    await page.goto(`${SITE_BASE_URL}/`);

    await expect(
      page.getByRole("heading", { name: /which version you approved/i }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /Start your 14-day free trial/i })
        .first(),
    ).toBeVisible();
    await expect(
      page.locator(".site-header").getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", `${APP_BASE_URL}/-/login`);
  });

  test("the app's home asks a signed-out visitor to sign in", async ({
    page,
  }) => {
    await page.goto(`${APP_BASE_URL}/`);

    await expect(page).toHaveURL(`${APP_BASE_URL}/-/login`);
    await expect(
      page.getByRole("heading", { name: "Step into the clean version." }),
    ).toBeVisible();
  });

  test("an app address on the site goes on to the app", async ({ page }) => {
    await page.goto(`${SITE_BASE_URL}/-/login`);
    await expect(page).toHaveURL(`${APP_BASE_URL}/-/login`);
  });

  test("an organization's address on the site is a 404 that links to the app", async ({
    page,
  }) => {
    // From before the move. The site cannot tell it from a typo, so it stays.
    const response = await page.goto(
      `${SITE_BASE_URL}/riverside-health/policies?tab=people`,
    );
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(
      `${SITE_BASE_URL}/riverside-health/policies?tab=people`,
    );
    await expect(
      page.getByRole("link", { name: "Open this address in the app" }),
    ).toHaveAttribute(
      "href",
      `${APP_BASE_URL}/riverside-health/policies?tab=people`,
    );
  });
});
