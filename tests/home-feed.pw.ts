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

test("Home lists what is waiting on you, each with its one act", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  const turn = page.getByRole("region", { name: "Your turn" });
  await expect(turn).toBeVisible({ timeout: 30_000 });
  // The seed asks Alice to review one of Carol's changes, sends two of her
  // own back, and approves two more.
  await expect(
    turn.getByRole("link", { name: /Review$/ }).first(),
  ).toBeVisible();
  await expect(
    turn.getByRole("link", { name: /Revise$/ }).first(),
  ).toBeVisible();
  await expect(
    turn.getByRole("link", { name: /Publish$/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/things? (is|are) waiting on you\./),
  ).toBeVisible();

  // A row opens the change it is about.
  await turn
    .getByRole("link", { name: /Review$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/-\/changes\/\d+$/, { timeout: 30_000 });
});

test("the whole picture is one link from Home", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);
  await page
    .getByRole("region", { name: "Your turn" })
    .getByRole("link", { name: "All change requests" })
    .click();
  await expect(page).toHaveURL(/\/-\/changes$/, { timeout: 30_000 });
  await expect(
    page.getByRole("region", { name: "Waiting on your review" }),
  ).toBeVisible();
});
