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

test("every one of the binder's screens is reachable on a phone", async ({
  page,
}) => {
  // A phone has no sidebar, so the binder's own screens are a strip under the
  // page title. The bug this replaced: six tabs wrapped, and the last two had
  // nothing to scroll to.
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);

  const strip = page.locator(".binder-strip");
  await expect(strip).toBeVisible({ timeout: 30_000 });

  // Settings is the last one and was the least reachable. Scrolling to it and
  // pressing it has to work, whether or not the strip needs to scroll at all.
  const settings = strip.getByRole("button", { name: "Settings" });
  await settings.scrollIntoViewIfNeeded();
  await settings.click();

  await expect(
    page.getByRole("heading", { name: "How changes are approved" }),
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

  // **The tree before the scroll.** The binder's contents are fetched after
  // the shell paints, so scrolling to `document.body.scrollHeight` while they
  // are still in flight scrolls to the bottom of a page that has not got its
  // rows yet — and then measures the row that arrives afterwards against a
  // bar it was never scrolled past.
  const lastRow = page.locator(".binder-tree-label").last();
  await expect(lastRow).toBeVisible({ timeout: 30_000 });

  // Scroll to the end and check the last policy clears the bar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);

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

test("no page scrolls sideways on a phone", async ({ page }) => {
  await signInAsAlice(page);

  // The policy page was the one that did: its title and its two actions sat
  // side by side, wider than the screen, and dragged the whole page — the
  // policy and its Download button with it — past the right edge.
  for (const path of [
    "/riverside-health/clinical/nursing/wards/handover-standard",
    "/riverside-health/clinical",
    "/riverside-health/clinical?tab=changes",
    "/riverside-health/clinical?tab=history",
    "/riverside-health/clinical?tab=settings",
    "/riverside-health",
    "/changes",
    "/documents",
    "/",
  ]) {
    await page.goto(`${APP_BASE_URL}${path}`);
    await expect(page.locator(".app-main h1").first()).toBeVisible({
      timeout: 30_000,
    });
    const overflow = await page.evaluate(
      () =>
        document.scrollingElement!.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${path} is wider than the phone`).toBeLessThanOrEqual(0);
  }
});
