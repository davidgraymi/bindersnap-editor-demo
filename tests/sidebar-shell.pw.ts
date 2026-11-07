/**
 * The global sidebar.
 *
 * What is worth guarding is that it shows one level at a time, the level you
 * are in, the way GitLab's does: your work on Home, an organization's pages
 * inside it, and a binder's inside a binder — each naming the place, with one
 * step back up.
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

test("the sidebar shows the level you are in: yours, then the organization's", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 30_000 });

  // On Home it is your work, across every organization, and the
  // organizations you are in as places to go — not one organization's pages
  // under a heading, beside entries that span all of them.
  await expect(sidebar.getByText("Your work", { exact: true })).toBeVisible();
  for (const label of ["Home", "Change requests", "Binders"] as const) {
    await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
  }
  const organizations = sidebar.getByRole("navigation", {
    name: "Your organizations",
  });
  await expect(
    organizations.getByRole("link", { name: "Riverside Health" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(sidebar.getByRole("link", { name: "Billing" })).toHaveCount(0);

  // Into the organization, and the sidebar is its: named once, its own pages
  // under it, and one step back to Home.
  await organizations.getByRole("link", { name: "Riverside Health" }).click();
  await expect(page).toHaveURL(/\/riverside-health$/, { timeout: 30_000 });
  const organization = sidebar.getByRole("navigation", {
    name: "Riverside Health",
  });
  for (const label of [
    "Binders",
    "People & access",
    "Billing",
    "Settings",
  ] as const) {
    await expect(organization.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(sidebar.getByText("Your work", { exact: true })).toHaveCount(0);
  // Titled for its level, as Home's is "Your work".
  await expect(
    organization.getByText("Organization", { exact: true }),
  ).toBeVisible();
  await expect(
    organization.getByRole("link", { name: "Binders" }),
  ).toHaveAttribute("aria-current", "page");

  // Its pages are the sidebar's, so the page has no row of tabs repeating
  // them, and each is titled for itself.
  await organization.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/riverside-health\/-\/settings$/);
  await expect(page.locator(".doc-header-title")).toHaveText("Settings");
  await expect(page.locator(".org-tabs")).toBeHidden();

  // **One destination per entry.** "Organization" opened the organization's
  // page, which "Binders" also opens; the customer read the map and
  // concluded one of them was broken.
  await expect(sidebar.getByRole("link", { name: "Organization" })).toHaveCount(
    0,
  );

  await organization.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(sidebar.getByText("Your work", { exact: true })).toBeVisible();
});

test("the sidebar navigates, and marks where you are", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("link", { name: "Change requests" }).click();

  await expect(
    page.getByRole("heading", { name: "Change requests" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/-/changes");
  await expect(
    sidebar.getByRole("link", { name: "Change requests" }),
  ).toHaveAttribute("aria-current", "page");

  // Binders, not documents: a binder is one scope, and a list mixing every
  // binder's files answered nothing.
  await expect(sidebar.getByRole("link", { name: "Documents" })).toHaveCount(0);
  await sidebar.getByRole("link", { name: "Binders" }).click();
  await expect(page).toHaveURL(/\/-\/binders$/, { timeout: 30_000 });
  await expect(sidebar.getByRole("link", { name: "Binders" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // **No entry for a page that does not exist yet.** Activity was a "coming
  // soon" placeholder in the map, which a reader who has never used GitHub
  // reads as broken.
  await expect(sidebar.getByRole("link", { name: "Activity" })).toHaveCount(0);
});

test("inside a binder, the sidebar is the binder's alone", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  // GitLab's project sidebar: the place named once, its own screens under it,
  // and nothing from the levels above — they put two "Change requests" and
  // two marked rows on screen at once.
  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar.locator(".app-sidebar-binder-name")).toHaveText(
    "Clinical",
    { timeout: 30_000 },
  );
  for (const entry of [
    "Documents",
    "Change requests",
    "History",
    "Settings",
  ] as const) {
    await expect(
      sidebar.getByRole("link", { name: new RegExp(`^${entry}`) }),
    ).toHaveCount(1);
  }
  await expect(sidebar.getByText("Your work", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Binder", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Organization", { exact: true })).toHaveCount(
    0,
  );
  await expect(sidebar.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await expect(
    sidebar.getByRole("link", { name: "Documents" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

  // The page's one title is the binder's contents.
  await expect(page.locator("h1.bs-title")).toHaveText("Clinical");

  // Settings lists its pages under it while one is open, and the page is
  // titled for the one you are on.
  await sidebar.getByRole("link", { name: /^Settings/ }).click();
  const pages = sidebar.locator(".app-sidebar-item--sub");
  await expect(pages).toHaveText(
    ["General", "People & access", "Change requests"],
    { timeout: 30_000 },
  );
  await pages.filter({ hasText: "Change requests" }).click();
  await expect(page).toHaveURL(/\/-\/settings\/change-requests$/);
  await expect(page.locator("h1.bs-title")).toHaveText("Change requests");
  await expect(sidebar.locator("[aria-current='page']")).toHaveText(
    "Change requests",
  );

  // One step back up, to the organization the binder is in, and the
  // organization's own map comes back.
  await sidebar.getByRole("link", { name: "Riverside Health" }).click();
  await expect(page).toHaveURL(/\/riverside-health$/, { timeout: 30_000 });
  await expect(sidebar.locator(".app-sidebar-binder")).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "Binders" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("exactly one navigation exists at any width", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  const bottomNav = page.locator(".app-bottom-nav");
  // Which organization you are in is a control, not a link — it is why the
  // switcher sits outside the nav.
  const switcher = page.locator(".app-topnav-org");

  // Home spans every organization, and its sidebar lists them, so the top
  // bar names none of them...
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toBeVisible();
  await expect(bottomNav).toBeHidden();
  await expect(switcher).toBeHidden();

  // ...except on a phone, where there is no sidebar and the switcher is the
  // way to an organization.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect(bottomNav).toBeVisible();
  await expect(switcher).toBeVisible();

  // Inside an organization it names it at every width.
  await page.goto(`${APP_BASE_URL}/riverside-health`);
  await expect(switcher).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(switcher).toBeVisible();

  // The top bar's own links are the navigation at neither width now. They were
  // only ever there because there was nowhere else to put them, and on a phone
  // they pushed search and the account control off the edge of a bar with
  // overflow:hidden.
  await expect(page.locator(".app-topnav-nav")).toBeHidden();
});

test("the top bar names the binder; the page names where in it", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // A policy used to name neither its binder nor its folder: the sidebar
  // collapses to icons while one is open, so the binder's name went with it.
  await page.goto(
    `${APP_BASE_URL}/riverside-health/clinical/nursing/wards/handover-standard`,
  );
  const trail = page.locator(".app-trail");
  const path = page.locator(".app-main .page-path");

  // The scope, up top — organization and binder, like GitHub's owner / repo,
  // and nothing deeper.
  const binderStep = trail.getByRole("link", { name: "Clinical" });
  await expect(binderStep).toHaveAttribute(
    "href",
    "/riverside-health/clinical",
    { timeout: 30_000 },
  );
  await expect(trail).not.toContainText("Nursing");

  // The path, in the page: its folders, then itself.
  await expect(path.locator("[aria-current='page']")).toHaveText(
    "Handover Standard",
  );
  await expect(path).toContainText("Nursing");
  await expect(path).toContainText("Wards");

  // A step is a real link — it opens in a new tab like any other — and a
  // plain click still moves inside the app.
  await binderStep.click();
  await expect(page).toHaveURL(/\/riverside-health\/clinical$/, {
    timeout: 30_000,
  });
  // On its own contents the binder is the page, and the page has no path.
  await expect(trail.locator("[aria-current='page']")).toHaveText("Clinical");
  await expect(path).toHaveCount(0);

  // A change request is under its binder's list, and the way back up is the
  // path above its title.
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=changes`);
  await page.locator(".change-row-open").first().click();
  await expect(page).toHaveURL(/\/-\/changes\/\d+$/, { timeout: 30_000 });
  // It names no number: the title is what the change is about.
  await expect(
    path.getByRole("link", { name: "Change requests" }),
  ).toBeVisible();
  await expect(path).not.toContainText(/Change \d+/);
  await expect(page.locator(".app-main .bs-crumbs")).toHaveCount(0);

  await path.getByRole("link", { name: "Change requests" }).click();
  await expect(page).toHaveURL(/\/-\/changes$/, { timeout: 30_000 });
});

test("sidebar entries are links, so they open in a new tab", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  const sidebar = page.locator(".app-sidebar");
  await expect(
    sidebar.getByRole("link", { name: "Riverside Health" }),
  ).toHaveAttribute("href", "/riverside-health");
  await expect(sidebar.getByRole("link", { name: /^History/ })).toHaveAttribute(
    "href",
    "/riverside-health/clinical/-/history",
  );

  // The organization's People tab is the sidebar's People & access — it used
  // to light up Binders instead.
  await page.goto(`${APP_BASE_URL}/riverside-health?tab=people`);
  await expect(
    sidebar.getByRole("link", { name: "People & access" }),
  ).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  await expect(
    sidebar.getByRole("link", { name: "Binders" }),
  ).not.toHaveAttribute("aria-current", "page");
});
