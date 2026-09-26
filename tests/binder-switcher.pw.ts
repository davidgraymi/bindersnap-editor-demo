import { expect, test } from "@playwright/test";

import { signInAsAlice } from "./helpers";

/**
 * The binder in the top bar switches to any other binder in the organization.
 *
 * Its name stays a link to the binder's contents; the chevron beside it opens
 * the list — the one you are in checked, and a way to all of them.
 */
test("the top bar's binder switches to any binder in the organization", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto("/riverside-health/corporate?tab=history");

  const trail = page.getByRole("navigation", {
    name: "Organization and binder",
  });
  await expect(trail.getByRole("link", { name: "Corporate" })).toHaveAttribute(
    "href",
    "/riverside-health/corporate",
  );

  await trail.getByRole("button", { name: /Switch binder/ }).click();
  const menu = page.getByRole("menu", { name: "Binders in this organization" });
  await expect(
    menu.getByRole("menuitemradio", { name: "Corporate" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    menu.getByRole("menuitemradio", { name: "Corporate" }),
  ).toBeFocused();
  await expect(menu.getByRole("menuitemradio")).toHaveCount(7);

  await menu.getByRole("menuitemradio", { name: "Clinical" }).click();
  await expect(page).toHaveURL(/\/riverside-health\/clinical$/);
  await expect(menu).toHaveCount(0);

  // And the way up to the whole list.
  await trail.getByRole("button", { name: /Switch binder/ }).click();
  await menu.getByRole("menuitem", { name: "All binders" }).click();
  await expect(page).toHaveURL(/\/riverside-health$/);
});
