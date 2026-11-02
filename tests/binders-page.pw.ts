/**
 * Your binders, across every organization — the page that was "Documents".
 *
 * A binder is one scope, as a repository is on GitHub, so the page lists the
 * binders themselves: what each is for, what you may do in it, and how busy
 * it is, ordered by what is yours, what is busy, or name.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test("every binder you can open is a tile, with what you may do in it", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/binders`);

  await expect(
    page.getByRole("heading", { name: "Binders", level: 1 }),
  ).toBeVisible({ timeout: 30_000 });
  const clinical = page.locator(".binders-tile", { hasText: "Clinical" });
  await expect(clinical).toBeVisible({ timeout: 30_000 });
  // Alice owns Riverside Health, so she runs every binder in it.
  await expect(clinical.locator(".binders-tile-access")).toHaveText("Admin");
  await expect(clinical.locator(".binders-tile-changes")).toContainText(
    /open change request/,
  );
  // One organization: no organization heading over the tiles.
  await expect(page.locator(".binders-group-title")).toHaveCount(0);
});

test("binders order by name, by activity, and narrow as you type", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/binders`);
  const names = page.locator(".binders-tile-name");
  await expect(names.first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "A–Z" }).click();
  const alphabetical = await names.allInnerTexts();
  expect(alphabetical).toEqual(
    [...alphabetical].sort((a, b) => a.localeCompare(b)),
  );

  // Most active: the most open change requests first.
  await page.getByRole("button", { name: "Most active" }).click();
  const counts = await page
    .locator(".binders-tile-changes")
    .allInnerTexts()
    .then((texts) => texts.map((text) => Number(/\d+/.exec(text)?.[0] ?? 0)));
  expect(counts).toEqual([...counts].sort((a, b) => b - a));

  await page.getByLabel("Filter binders").fill("corp");
  await expect(names).toHaveText(["Corporate"]);
});

test("a tile opens its binder", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/binders`);
  const tile = page.locator(".binders-tile", { hasText: "Safety" });
  await expect(tile).toHaveAttribute("href", "/riverside-health/safety", {
    timeout: 30_000,
  });
  await tile.click();
  await expect(page).toHaveURL(/\/riverside-health\/safety$/, {
    timeout: 30_000,
  });
});
