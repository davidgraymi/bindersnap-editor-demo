/**
 * The sign-off rules on a binder's Approvals tab, when there are none.
 *
 * They are rows of the one approval table, under the binder's own "Every
 * change" rule, so a binder with none shows that row and an offer to add one —
 * not an essay. The page used to open its sign-off section on four sentences
 * explaining what a rule is, above the binder's actual approval rule, which
 * was the most-missed setting in the product.
 *
 * The second thing here is an action-hierarchy bug: "Propose these rules" was
 * pressable with nothing drafted, so pressing it opened a change request that
 * changed nothing. It appears only once the rules on screen differ from the
 * ones published.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

test("with no rules, the table offers to add one", async ({ page }) => {
  await signInAsAlice(page);
  // The address the sign-off rules had before Approvals was a tab still
  // lands on it.
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  await expect(page.getByRole("tab", { name: "Approvals" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 30_000 },
  );
  await expect(
    page.locator("#sign-off .rev-rules-name", { hasText: "Every change" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a rule for a folder or document" }),
  ).toBeVisible();
});

test("nothing to propose means nothing to press", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(
    `${APP_BASE_URL}/riverside-health/clinical/-/settings/approvals`,
  );

  await page
    .getByRole("button", { name: "Add a rule for a folder or document" })
    .click({ timeout: 30_000 });

  // Nothing drafted, so nothing to send — and a rule with no subject and
  // nobody to sign it off is not a rule, so Add waits for both.
  await expect(
    page.getByRole("button", { name: "Propose these rules" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add this rule" }),
  ).toBeDisabled();
});

test("drafting a rule makes Propose pressable", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(
    `${APP_BASE_URL}/riverside-health/clinical/-/settings/approvals`,
  );

  await page
    .getByRole("button", { name: "Add a rule for a folder or document" })
    .click({ timeout: 30_000 });
  const foot = page.locator("#sign-off .bs-panel-foot").first();
  await foot
    .getByRole("combobox", { name: "What has to be signed off" })
    .selectOption("binder");
  await foot
    .getByRole("combobox", { name: "Which group signs it off" })
    .selectOption({ index: 1 });

  const addRule = page.getByRole("button", { name: "Add this rule" });
  await expect(addRule).toBeEnabled();
  await addRule.click();

  // On screen as a row, and not yet anything more than that.
  await expect(
    page.locator("#sign-off .rev-rules-name", {
      hasText: "Everything in this binder",
    }),
  ).toBeVisible();

  const propose = page.getByRole("button", { name: "Propose these rules" });
  await expect(propose).toBeEnabled({ timeout: 30_000 });
  await expect(propose).toHaveClass(/bs-btn-primary/);

  // And taking it back out leaves nothing to propose again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(propose).toHaveCount(0);
});
