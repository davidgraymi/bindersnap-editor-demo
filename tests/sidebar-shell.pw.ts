/**
 * The global sidebar.
 *
 * Two things worth guarding. That the sidebar is a map of the whole product —
 * the destinations the top bar never carried are on it. And that it did not eat
 * the binder: a binder is a place with its own tabs, which is ADR 0004's reason
 * for the level, and the mockups this came from had no binder-scoped screen at
 * all.
 *
 * The third is the breakpoint. The sidebar is display:none below 768px and the
 * top bar's own links are hidden above it, so exactly one navigation exists at
 * any width — and neither is duplicated.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  // The hook has its own budget, and describe.configure's timeout does not
  // reach it. Seeding is idempotent but not instant on a loaded runner, and a
  // 10s hook fails the suite before a single assertion has run.
  test.setTimeout(90_000);
  await seedDevStack();
});

test("the sidebar is the map, grouped into work, manage and settings", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 30_000 });

  // The destinations the top bar never had are the point of the whole thing.
  for (const label of [
    "Home",
    "Change requests",
    "Documents",
    "Binders",
    "People & access",
    "Activity",
    "Organization",
    "Billing",
  ] as const) {
    await expect(sidebar.getByRole("button", { name: label })).toBeVisible();
  }

  // The grouping is the teaching — a flat list of eight would answer "where is
  // billing" no better than the top bar did.
  await expect(sidebar.getByText("Manage", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible();
});

test("the sidebar navigates, and marks where you are", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("button", { name: "Change requests" }).click();

  await expect(
    page.getByRole("heading", { name: "Change requests" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/changes");
  await expect(
    sidebar.getByRole("button", { name: "Change requests" }),
  ).toHaveAttribute("aria-current", "page");

  await sidebar.getByRole("button", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/activity$/, { timeout: 30_000 });
  await expect(
    sidebar.getByRole("button", { name: "Activity" }),
  ).toHaveAttribute("aria-current", "page");
});

test("the sidebar did not eat the binder", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  // A binder still has its own six tabs, under the global sidebar.
  for (const tab of [
    "Documents",
    "Change requests",
    "People",
    "Sign-off rules",
    "History",
    "Settings",
  ] as const) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible({
      timeout: 30_000,
    });
  }

  // And the sidebar keeps your place rather than losing it: a binder, and a
  // document inside one, are both "in" Binders.
  const sidebar = page.locator(".app-sidebar");
  await expect(
    sidebar.getByRole("button", { name: "Binders" }),
  ).toHaveAttribute("aria-current", "page");
});

test("exactly one navigation exists at any width", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  const topnavLinks = page.locator(".app-topnav-nav");
  // Which organization you are looking at is a control, not a link, and is
  // wanted at both widths — it is why the switcher sits outside that nav.
  const switcher = page.locator(".app-topnav-org");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toBeVisible();
  await expect(topnavLinks).toBeHidden();
  await expect(switcher).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect(topnavLinks).toBeVisible();
  await expect(switcher).toBeVisible();
});
