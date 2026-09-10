/**
 * The shell on a phone.
 *
 * The sidebar is `display: none` below 768px, so until this existed a small
 * screen navigated from links squeezed into the top bar — which has
 * `overflow: hidden` and three links to fit, so search, notifications and the
 * account control were pushed off the right edge and could not be reached at
 * all. And the binder's six tabs wrapped: "Sign-off rules" folded onto three
 * lines and History and Settings fell off the bottom with nothing to scroll to,
 * which made two tabs of a binder unreachable on a phone.
 *
 * For a product whose central act is a named person signing off, approving from
 * a phone is not an edge case.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const PHONE = { width: 390, height: 844 };

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

test("a phone gets a bottom bar instead of the sidebar", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const bottom = page.locator(".app-bottom-nav");
  await expect(bottom).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".app-sidebar")).toBeHidden();

  for (const label of ["Home", "Changes", "Policies", "Binders"] as const) {
    await expect(bottom.getByRole("button", { name: label })).toBeVisible();
  }
});

test("the bottom bar navigates and marks where you are", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const bottom = page.locator(".app-bottom-nav");
  await bottom.getByRole("button", { name: "Changes" }).click();

  await expect(page).toHaveURL(/\/changes$/, { timeout: 30_000 });
  await expect(bottom.getByRole("button", { name: "Changes" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("search and the account are reachable on a phone", async ({ page }) => {
  // Both were off the right edge of a bar with overflow:hidden.
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const trigger = page.locator(".app-nav-search-trigger");
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".app-topnav-avatar")).toBeVisible();

  // And it opens, which is the point of it being reachable.
  await trigger.click();
  await expect(
    page.getByRole("combobox", {
      name: "Search binders, policies, or people",
    }),
  ).toBeVisible({ timeout: 30_000 });
});

test("every binder tab is reachable on a phone", async ({ page }) => {
  // The bug: six tabs wrapped, and the last two had nothing to scroll to.
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  const tabs = page.locator(".doc-tabs");
  await expect(tabs).toBeVisible({ timeout: 30_000 });

  // The strip scrolls sideways rather than wrapping, so it is wider than the
  // box it sits in.
  const overflows = await tabs.evaluate(
    (el) => el.scrollWidth > el.clientWidth + 1,
  );
  expect(overflows).toBe(true);

  // Settings is the last tab and was the least reachable. Scrolling to it and
  // pressing it has to work.
  const settings = page.getByRole("tab", { name: "Settings" });
  await settings.scrollIntoViewIfNeeded();
  await settings.click();

  await expect(
    page.getByRole("heading", { name: "The rules", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
});

test("the bottom bar does not sit on top of the last row of content", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);
  await expect(page.locator(".app-bottom-nav")).toBeVisible({
    timeout: 30_000,
  });

  // Scroll to the end and check the last policy clears the bar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);

  const lastRow = page.locator(".docs-list-item-name").last();
  await expect(lastRow).toBeVisible();

  const [rowBottom, barTop] = await Promise.all([
    lastRow.evaluate((el) => el.getBoundingClientRect().bottom),
    page
      .locator(".app-bottom-nav")
      .evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(rowBottom).toBeLessThanOrEqual(barTop);
});

test("a desktop viewport keeps the sidebar and has no bottom bar", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".app-sidebar")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".app-bottom-nav")).toBeHidden();
});
