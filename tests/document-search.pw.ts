/**
 * Quick find searches what a policy says, not only what it is called.
 *
 * A reader opens Bindersnap to find out what the policy says, and a search
 * that matched titles alone could not help them with that: "respirators"
 * found nothing, because no policy is called that. ADR 0007's first step is
 * that the words of every document on `main` are searchable, and a result
 * opens the document.
 *
 * Against the seed's real Word file, read by the API's own index job — the
 * whole question is whether the words come out of what was uploaded.
 */

import { expect, test, type Page } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

/**
 * Ask quick find something and wait for the panel to settle. Reloads first,
 * so a retry is a new question rather than the cached answer to the last.
 */
async function ask(page: Page, query: string) {
  await page.goto(APP_BASE_URL);
  await page.locator(".app-nav-search-trigger").click();
  const field = page.getByRole("combobox", { name: "Search Bindersnap" });
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(query);
  await expect(
    page
      .locator(".quick-find-dialog")
      .locator(".quick-find-group, .quick-find-empty, .quick-find-note"),
  ).not.toHaveCount(0, { timeout: 30_000 });
}

test("a word only in a policy's body finds it, with the passage", async ({
  page,
}) => {
  await signInAsAlice(page);
  const policy = page
    .locator(".quick-find-dialog")
    .getByRole("option", { name: /Infection Control Policy/ });

  // The index reads a binder after the seed publishes into it. Asked again
  // until it has, rather than slept for.
  await expect(async () => {
    await ask(page, "respirators");
    await expect(policy).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // The passage it matched in, the word marked.
  await expect(policy.locator(".quick-find-result-excerpt")).toContainText(
    "fit-tested",
  );
  await expect(policy.locator(".quick-find-result-excerpt mark")).toHaveText(
    /respirators/i,
  );

  // And picking it opens the document.
  await policy.click();
  await expect(page).toHaveURL(/\/nursing\/infection-control-policy/, {
    timeout: 30_000,
  });
});

test("words only in an open change are not found", async ({ page }) => {
  // "Refilling" is in the change that tightens hand hygiene auditing, which
  // is still in review. A reader who finds unapproved text has found the
  // wrong answer, so search reads `main` only.
  await signInAsAlice(page);

  // Wait until the index holds the binder, so "nothing" means "not on main"
  // and not "not read yet".
  await expect(async () => {
    await ask(page, "respirators");
    await expect(
      page
        .locator(".quick-find-dialog")
        .getByRole("option", { name: /Infection Control Policy/ }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  await ask(page, "refilling");
  await expect(
    page
      .locator(".quick-find-dialog")
      .getByRole("option", { name: /Infection Control Policy/ }),
  ).toHaveCount(0);
});
