/**
 * Home is what has been happening in your binders.
 *
 * It was a second list of change requests beside the page that lists them.
 * Now it is a feed read from Gitea's own activity feed, a day at a time: who
 * opened, approved, discussed or published what. The seed has all of those.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test("Home is a feed of what happened, a day at a time", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const items = page.locator(".home-feed-item");
  await expect(items.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".home-feed-day-label").first()).toBeVisible();

  // Sentences about change requests, said the product's way — and none of
  // Gitea's own noise: commits to a branch, tags, branches deleted.
  const lines = await page.locator(".home-feed-line").allInnerTexts();
  expect(lines.some((line) => / (published|approved|opened) /.test(line))).toBe(
    true,
  );
  for (const line of lines) {
    expect(line).not.toMatch(/pushed|commit|tag|branch|bindersnap:v1/i);
  }

  // Not the change requests list again: those rows live on their own page.
  await expect(page.locator(".change-row")).toHaveCount(0);
});

test("an event opens the change it is about", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const about = page
    .locator(".home-feed-link")
    .filter({ hasText: / (published|approved|opened|commented on) / })
    .first();
  await expect(about).toBeVisible({ timeout: 30_000 });
  await expect(about).toHaveAttribute("href", /\/-\/changes\/\d+$/);
  await about.click();
  await expect(page).toHaveURL(/\/-\/changes\/\d+$/, { timeout: 30_000 });
});

test("what is waiting on your review is one line that leads to it", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  // The seed asks Alice to review one of Carol's changes.
  const waiting = page.locator(".home-waiting");
  await expect(waiting).toContainText("waiting on your review", {
    timeout: 30_000,
  });
  await waiting.click();
  await expect(page).toHaveURL(/\/-\/changes$/, { timeout: 30_000 });
  await expect(
    page.getByRole("region", { name: "Waiting on your review" }),
  ).toBeVisible();
});
