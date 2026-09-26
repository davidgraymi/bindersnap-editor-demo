import { expect, test } from "@playwright/test";

import { signInAsAlice } from "./helpers";

// Sign-in and four page loads, each one booting the app and reading its
// session again. That is ~10s on a loaded runner — the suite-wide budget, with
// nothing spare — so it gets the room the other multi-page files already have.
test.describe.configure({ timeout: 30_000 });

/**
 * An address with no binder behind it gets a page that says so.
 *
 * It used to crash the app outright — the documents list skipped a hook on
 * its error path, and React tore the whole page down — and before that, drew
 * a binder around one red line.
 */
test("a binder that does not exist is a not-found page, not a crash", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await signInAsAlice(page);
  await page.goto("/riverside-health/no-such-binder");

  await expect(
    page.getByRole("heading", { name: "Binder not found" }),
  ).toBeVisible();
  // No binder, so nothing to add to it or edit.
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  // And the top bar stops at the organization instead of naming it.
  const trail = page.getByRole("navigation", {
    name: "Organization and binder",
  });
  await expect(trail).toBeVisible();
  await expect(trail).not.toContainText("No Such Binder");

  // A binder that is there still gets its name back.
  await page.goto("/riverside-health/corporate");
  await expect(trail).toContainText("Corporate");
  await page.goto("/riverside-health/no-such-binder");

  await page.getByRole("link", { name: /^Back to / }).click();
  await expect(page).toHaveURL(/\/riverside-health$/);
  expect(errors).toEqual([]);
});
