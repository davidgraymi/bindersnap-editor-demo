/**
 * The sign-off rules on a binder's Settings page, when there are none.
 *
 * Six lines in a full viewport was the review's example of the density
 * problem, and the fix is not a rail: when there are no rules the empty state
 * *is* the page, so it says what a sign-off rule does rather than only that
 * there is none. It disappears the moment a rule exists, which is what keeps it
 * from being the permanent onboarding copy the mockups drew.
 *
 * The second thing here is an action-hierarchy bug the review's Task 3 missed:
 * "Propose these rules" was pressable with nothing drafted, so pressing it
 * opened a change request that changed nothing. It is pressable only once the
 * rules on screen differ from the ones published.
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

  const empty = page.locator("#sign-off .bs-empty");
  await expect(empty).toBeVisible({ timeout: 30_000 });

  // What it is, and a worked example — a reader who has never set one cannot
  // act on "nothing needs its own sign-off".
  await expect(empty).toContainText("Nothing here needs its own sign-off yet");
  await expect(empty).toContainText(
    "adds a second requirement to one part of it",
  );
  await expect(empty).toContainText("signs off on anything filed in nursing");
  // And what a rule may cover, which is no longer only a folder — and now
  // includes the rules themselves, which is the one scope somebody would never
  // guess was available.
  await expect(empty).toContainText(
    "this whole binder, one folder, a single document, or these rules themselves",
  );
});

test("nothing to propose means nothing to press", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  const propose = page.getByRole("button", { name: "Propose these rules" });
  const addRule = page.getByRole("button", { name: "Add a rule" });

  await expect(propose).toBeVisible({ timeout: 30_000 });

  // Nothing drafted, so nothing to send — and a rule with no subject and
  // nobody to sign it off is not a rule, so Add waits for both.
  await expect(propose).toBeDisabled();
  await expect(addRule).toBeDisabled();
});

test("drafting a rule makes Propose pressable", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  const foot = page.locator("#sign-off .bs-panel-foot").first();
  const covers = foot.getByRole("combobox", {
    name: "What has to be signed off",
  });
  await expect(covers).toBeVisible({ timeout: 30_000 });
  await covers.selectOption("binder");
  await foot
    .getByRole("combobox", { name: "Which group signs it off" })
    .selectOption({ index: 1 });

  const addRule = page.getByRole("button", { name: "Add a rule" });
  await expect(addRule).toBeEnabled();
  await addRule.click();

  // On screen as a row, and not yet anything more than that.
  await expect(page.locator("#sign-off .bs-empty")).toHaveCount(0);
  await expect(
    page.locator("#sign-off .bs-row-name", {
      hasText: "Everything in this binder",
    }),
  ).toBeVisible();

  const propose = page.getByRole("button", { name: "Propose these rules" });
  await expect(propose).toBeEnabled({ timeout: 30_000 });
  await expect(propose).toHaveClass(/bs-btn-primary/);

  // And taking it back out leaves nothing to propose again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(propose).toBeDisabled();
});

test("prose is capped at a measure rather than the width of the column", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=settings`);

  const note = page.locator("#sign-off .bs-empty p").last();
  await expect(note).toBeVisible({ timeout: 30_000 });

  // The page column is sized for a list of documents. A sentence in it ran to
  // about 110 characters, which is well past what a reader tracks a line at.
  const width = await note.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThan(760);
});
