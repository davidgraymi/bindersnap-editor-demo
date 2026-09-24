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
    "Billing",
  ] as const) {
    await expect(sidebar.getByRole("button", { name: label })).toBeVisible();
  }

  // The grouping is the teaching — a flat list of seven would answer "where is
  // billing" no better than the top bar did.
  await expect(sidebar.getByText("Manage", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible();

  // **One destination per entry.** "Organization" opened the organization's
  // page, which is the binder list, which "Binders" above it opens, which the
  // org button in the top bar also opens: three entries, one destination, and
  // the customer read the map and concluded two of them were broken. It is
  // gone rather than repointed — "Binders" is the organization's home and
  // "People & access" is the rest of it, so there was nothing left for a
  // third entry to mean.
  await expect(
    sidebar.getByRole("button", { name: "Organization" }),
  ).toHaveCount(0);
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

  await sidebar.getByRole("button", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/documents$/, { timeout: 30_000 });
  await expect(
    sidebar.getByRole("button", { name: "Documents" }),
  ).toHaveAttribute("aria-current", "page");

  // **No entry for a page that does not exist yet.** Activity was a "coming
  // soon" placeholder in the map, which a reader who has never used GitHub
  // reads as broken.
  await expect(sidebar.getByRole("button", { name: "Activity" })).toHaveCount(
    0,
  );
});

test("the sidebar took the binder, and gives it a section of its own", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  // A binder is still a place: it owns a labelled section of the map, named
  // once, with its own screens under it — and no "Policies" entry, because
  // the binder's own name is it.
  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar.locator(".app-sidebar-binder-name")).toHaveText(
    "Clinical",
    { timeout: 30_000 },
  );
  for (const entry of ["Changes", "History", "Settings"] as const) {
    await expect(
      sidebar.getByRole("button", { name: new RegExp(`^${entry}`) }).last(),
    ).toBeVisible();
  }

  // And the page's one title is the binder's contents, not a heading naming
  // the binder you are visibly inside.
  await expect(page.locator("h1.bs-title")).toHaveText("Clinical");

  // It goes when you leave.
  await sidebar.getByRole("button", { name: "Home" }).click();
  await expect(sidebar.locator(".app-sidebar-binder")).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  // And the sidebar keeps your place rather than losing it: a binder, and a
  // document inside one, are both "in" Binders.
  await expect(
    sidebar.getByRole("button", { name: "Binders" }),
  ).toHaveAttribute("aria-current", "page");
});

test("exactly one navigation exists at any width", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  const bottomNav = page.locator(".app-bottom-nav");
  // Which organization you are looking at is a control, not a link, and is
  // wanted at both widths — it is why the switcher sits outside the nav.
  const switcher = page.locator(".app-topnav-org");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toBeVisible();
  await expect(bottomNav).toBeHidden();
  await expect(switcher).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect(bottomNav).toBeVisible();
  await expect(switcher).toBeVisible();

  // The top bar's own links are the navigation at neither width now. They were
  // only ever there because there was nowhere else to put them, and on a phone
  // they pushed search and the account control off the edge of a bar with
  // overflow:hidden.
  await expect(page.locator(".app-topnav-nav")).toBeHidden();
});
