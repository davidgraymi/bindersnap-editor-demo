import { expect, test } from "@playwright/test";

import { signInAsBob } from "./helpers";

// A browser test that signs in, navigates and waits on the network does not
// fit the suite-wide 10s budget on a loaded runner.
test.describe.configure({ timeout: 60_000 });

/**
 * The top bar's "+" makes what has no page to be added from: a binder in the
 * organization on screen, or a new organization. A document is added on its
 * binder's page, where the binder is already chosen.
 */
test.describe("top bar create menu", () => {
  test("offers a new binder in this organization, and opens its form", async ({
    page,
  }) => {
    await signInAsBob(page);
    await page.goto("/riverside-health");

    const plus = page.getByRole("button", { name: "Create new…" });
    await expect(plus).toHaveText("");
    await plus.click();

    const menu = page.getByRole("menu", { name: "Create new" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      /New binder\s*In Riverside Health/,
      /New organization/,
    ]);
    await expect(menu).not.toContainText("document");

    await menu.getByRole("menuitem", { name: /New binder/ }).click();
    await expect(page).toHaveURL(/\/riverside-health\?new=binder$/);
    await expect(page.locator("h1.bs-title")).toHaveText("New binder");
  });

  test("offers a new organization, and opens the setup page", async ({
    page,
  }) => {
    await signInAsBob(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Create new…" }).click();
    await page.getByRole("menuitem", { name: /New organization/ }).click();
    await expect(page).toHaveURL(/\/organizations\/new$/);
  });

  test("Escape closes it and hands focus back", async ({ page }) => {
    await signInAsBob(page);
    await page.goto("/");

    const plus = page.getByRole("button", { name: "Create new…" });
    await plus.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(plus).toBeFocused();
  });
});
