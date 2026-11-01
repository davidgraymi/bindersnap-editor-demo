/**
 * Every change request in an organization's binders.
 *
 * A binder's own Change requests list, one level up — the way a GitLab group
 * lists every project's merge requests — reached from the organization's
 * sidebar, each row naming its binder.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test("the organization lists every binder's change requests", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health`);

  const sidebar = page.locator(".app-sidebar");
  await sidebar.getByRole("link", { name: /^Change requests/ }).click();
  await expect(page).toHaveURL(/\/riverside-health\/-\/changes$/, {
    timeout: 30_000,
  });
  await expect(page.locator(".doc-header-title")).toHaveText("Change requests");

  // More than one binder's, each row leading with the binder it is in.
  const meta = page.locator(".change-row .bs-row-meta");
  await expect(meta.first()).toBeVisible({ timeout: 30_000 });
  await expect(meta.filter({ hasText: "Clinical" }).first()).toBeVisible();
  await expect(meta.filter({ hasText: "Corporate" }).first()).toBeVisible();

  // The sidebar counts what the list holds.
  const open = Number(
    (await page.locator(".queue-counter-value").first().innerText()).trim(),
  );
  await expect(page.locator(".change-row")).toHaveCount(open);
  await expect(
    sidebar
      .getByRole("link", { name: /^Change requests/ })
      .locator(".app-sidebar-item-count"),
  ).toHaveText(String(open));
});

test("a row opens the change on its own binder, and Closed is the record", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/-/changes`);

  const row = page.locator(".change-row-open").first();
  await expect(row).toHaveAttribute(
    "href",
    /^\/riverside-health\/[^/]+\/-\/changes\/\d+$/,
    { timeout: 30_000 },
  );

  await page.getByRole("button", { name: /^Closed/ }).click();
  await expect(page.locator(".change-row").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator(".change-row .change-standing").first()).toHaveText(
    /Published|Declined|Withdrawn/,
  );

  await page.getByRole("button", { name: /^Open/ }).click();
  await row.click();
  await expect(page).toHaveURL(/\/riverside-health\/[^/]+\/-\/changes\/\d+$/, {
    timeout: 30_000,
  });
});
