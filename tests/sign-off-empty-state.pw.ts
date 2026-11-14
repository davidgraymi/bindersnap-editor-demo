/**
 * The sign-off rules on a binder's Change requests settings: a read-only list
 * of every rule in the binder (4.12), each linking to where it is set. Rules
 * are changed on each folder, in the editor, in a draft — Settings no longer
 * edits them, so the tab has one save model.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

test("with no rules, the table has the binder's own row and says where rules are set", async ({
  page,
}) => {
  await signInAsAlice(page);
  // The address the sign-off rules had before they joined the approval table
  // still lands on it.
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical?tab=sign-off`);

  await expect(page.locator("h1.bs-title")).toHaveText("Change requests", {
    timeout: 30_000,
  });
  const table = page.locator("#sign-off");
  await expect(
    table.locator(".rev-rules-name", { hasText: "Every change" }),
  ).toBeVisible();
  await expect(table).toContainText(
    "Who signs off is changed on each folder, in the editor.",
  );
  await expect(
    page.getByRole("button", { name: "Add a rule for a folder or document" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Propose these rules" }),
  ).toHaveCount(0);
});

test("every rule is listed, and each opens where it is set", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(
    `${APP_BASE_URL}/riverside-health/governance/-/settings/change-requests`,
  );
  const table = page.locator("#sign-off");
  const folder = table.getByRole("link", { name: /Clinical Standards/ });
  await expect(folder).toBeVisible({ timeout: 30_000 });
  await expect(
    table.getByRole("button", { name: /^Change the rule/ }),
  ).toHaveCount(0);
  await folder.click();
  await expect(page).toHaveURL(
    `${APP_BASE_URL}/riverside-health/governance/-/tree/main/clinical-standards`,
  );
});
