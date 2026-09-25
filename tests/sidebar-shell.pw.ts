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

test("the sidebar is the map, grouped by scope: yours, then the organization's", async ({
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
    await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
  }

  // The grouping is the teaching, and each group is a scope with a name: your
  // work spans every organization; Binders, People and Billing are one
  // organization's, and the heading says which.
  await expect(sidebar.getByText("Your work", { exact: true })).toBeVisible();
  const organization = sidebar.getByRole("navigation", {
    name: "Riverside Health",
  });
  await expect(organization).toContainText("Riverside Health");
  for (const label of ["Binders", "People & access", "Billing"] as const) {
    await expect(organization.getByRole("link", { name: label })).toBeVisible();
  }

  // **One destination per entry.** "Organization" opened the organization's
  // page, which is the binder list, which "Binders" above it opens, which the
  // org button in the top bar also opens: three entries, one destination, and
  // the customer read the map and concluded two of them were broken. It is
  // gone rather than repointed — "Binders" is the organization's home and
  // "People & access" is the rest of it, so there was nothing left for a
  // third entry to mean.
  await expect(sidebar.getByRole("link", { name: "Organization" })).toHaveCount(
    0,
  );
});

test("the sidebar navigates, and marks where you are", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("link", { name: "Change requests" }).click();

  await expect(
    page.getByRole("heading", { name: "Change requests" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/changes");
  await expect(
    sidebar.getByRole("link", { name: "Change requests" }),
  ).toHaveAttribute("aria-current", "page");

  await sidebar.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/documents$/, { timeout: 30_000 });
  await expect(
    sidebar.getByRole("link", { name: "Documents" }),
  ).toHaveAttribute("aria-current", "page");

  // **No entry for a page that does not exist yet.** Activity was a "coming
  // soon" placeholder in the map, which a reader who has never used GitHub
  // reads as broken.
  await expect(sidebar.getByRole("link", { name: "Activity" })).toHaveCount(0);
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
      sidebar.getByRole("link", { name: new RegExp(`^${entry}`) }).last(),
    ).toBeVisible();
  }

  // And the page's one title is the binder's contents, not a heading naming
  // the binder you are visibly inside.
  await expect(page.locator("h1.bs-title")).toHaveText("Clinical");

  // It goes when you leave.
  await sidebar.getByRole("link", { name: "Home" }).click();
  await expect(sidebar.locator(".app-sidebar-binder")).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  // And the sidebar keeps your place rather than losing it: a binder, and a
  // document inside one, are both "in" Binders.
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
  await expect(page).toHaveURL(/change=\d+/, { timeout: 30_000 });
  await expect(path.locator("[aria-current='page']")).toHaveText(
    /^Change \d+$/,
  );
  await expect(page.locator(".app-main .bs-crumbs")).toHaveCount(0);

  await path.getByRole("link", { name: "Change requests" }).click();
  await expect(page).toHaveURL(/tab=changes$/, { timeout: 30_000 });
});

test("sidebar entries are links, so they open in a new tab", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar.getByRole("link", { name: "Home" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(sidebar.getByRole("link", { name: /^History/ })).toHaveAttribute(
    "href",
    "/riverside-health/clinical?tab=history",
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
