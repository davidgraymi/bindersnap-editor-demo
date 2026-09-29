import { expect, test } from "@playwright/test";

import { signInAsAlice } from "./helpers";

// Sign-in, an organization page and the billing page, each waiting on the
// API: more than the suite's 10s default on a loaded runner.
test.describe.configure({ timeout: 30_000 });

/**
 * Billing is a page of the app, reached from the sidebar and left the same way.
 *
 * It used to borrow the sign-in card — no sidebar, no top bar, and "Sign out"
 * as its only way off — and to tell every organization without a Stripe
 * subscription to "Start your subscription", including one with nothing to
 * pay.
 */
test("billing opens inside the app and says where the organization stands", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto("/riverside-health");

  await page
    .locator(".app-sidebar")
    .getByRole("link", { name: "Billing" })
    .click();

  // This organization's billing: the entry sits under its name.
  await expect(page).toHaveURL(/\/riverside-health\/-\/billing$/);
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  const plan = page.getByRole("region", { name: "Plan" });
  await expect(plan).toBeVisible();
  // The seeded stack exempts its users from billing: access with nothing to
  // buy, so nothing offers to sell it.
  await expect(plan).toContainText("Complimentary");
  await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);

  // Still in the shell: the sidebar is there to leave by.
  await page
    .locator(".app-sidebar")
    .getByRole("link", { name: "Home" })
    .click();
  await expect(page).toHaveURL(/\/$/);
});

test("the old /billing address says which organization it is showing", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto("/billing");

  await expect(page).toHaveURL(/\/[^/?]+\/-\/billing$/);
  await expect(page.getByRole("region", { name: "Plan" })).toBeVisible();
});
