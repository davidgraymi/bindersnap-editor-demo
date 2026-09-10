/**
 * The Sign-off rules tab when there are no rules.
 *
 * Six lines in a full viewport was the review's example of the density
 * problem, and the fix is not a rail: when there are no rules the empty state
 * *is* the page, so it says what a sign-off rule does rather than only that
 * there is none. It disappears the moment a rule exists, which is what keeps it
 * from being the permanent onboarding copy the mockups drew.
 *
 * The second thing here is an action-hierarchy bug the review's Task 3 missed:
 * "Propose these rules" was the coral primary with nothing drafted and nothing
 * published, so pressing it opened a change request that changed nothing.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test("with no rules, the page says what a rule is", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  const empty = page.locator(".binder-empty-rule");
  await expect(empty).toBeVisible({ timeout: 30_000 });

  // What it is, and a worked example — a reader who has never set one cannot
  // act on "no folder needs its own sign-off".
  await expect(empty).toContainText("No folder needs its own sign-off yet");
  await expect(empty).toContainText("adds a second requirement to one folder");
  await expect(empty).toContainText("signs off on anything filed in nursing");
});

test("nothing to propose means nothing to press", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  const propose = page.getByRole("button", { name: "Propose these rules" });
  const addRule = page.getByRole("button", { name: "Add a rule" });

  await expect(addRule).toBeVisible({ timeout: 30_000 });

  // Nothing drafted, nothing published: proposing would open a change request
  // that changes nothing.
  await expect(propose).toBeDisabled();
  // And adding the first rule is the primary act, so it carries the weight.
  await expect(addRule).toHaveClass(/bs-btn-primary/);
  await expect(propose).not.toHaveClass(/bs-btn-primary/);
});

test("drafting a rule hands the weight back to Propose", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  const addRule = page.getByRole("button", { name: "Add a rule" });
  await expect(addRule).toBeVisible({ timeout: 30_000 });
  await addRule.click();

  const propose = page.getByRole("button", { name: "Propose these rules" });
  await expect(propose).toBeEnabled({ timeout: 30_000 });
  await expect(propose).toHaveClass(/bs-btn-primary/);
  await expect(addRule).not.toHaveClass(/bs-btn-primary/);
});

test("prose is capped at a measure rather than the width of the column", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=settings`);

  const note = page.locator(".doc-rail-note").first();
  await expect(note).toBeVisible({ timeout: 30_000 });

  // The page column is sized for a list of documents. A sentence in it ran to
  // about 110 characters, which is well past what a reader tracks a line at.
  const width = await note.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(760);
});
