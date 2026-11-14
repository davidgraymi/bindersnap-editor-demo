/**
 * Edit, on a document somebody is already changing, asks first.
 *
 * The seed's Clinical "Infection Control Policy" (a Word file) is in Alice's
 * open change "Tighten hand hygiene auditing and new-hire training", with
 * Grace as its co-editor.
 */
import { expect, test } from "@playwright/test";

import { APP_BASE_URL, OWNER, signInAsAlice, signInAsBob } from "./helpers";

// Several pages read in turn, on a CI runner shared with every other suite:
// the suite default of ten seconds is for one page.
test.describe.configure({ timeout: 120_000 });

const DOCUMENT = `${APP_BASE_URL}/${OWNER}/clinical/-/blob/main/nursing/infection-control-policy`;
const TITLE = "Tighten hand hygiene auditing and new-hire training";

test("somebody else's change is commented on, not written in", async ({
  page,
}) => {
  await signInAsBob(page);
  await page.goto(DOCUMENT);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Alice Nguyen is already changing this document.",
  );
  await expect(dialog).toContainText(TITLE);
  await expect(
    dialog.getByRole("button", { name: "Continue in it" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Start a separate change" }),
  ).toBeVisible();

  // Escape puts the page back as it was.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Comment on it" }).click();
  await expect(page).toHaveURL(/\/-\/changes\/\d+\/diffs/);
});

test("the author continues in their own change", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(DOCUMENT);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "You already have a change open for this document.",
  );
  await dialog.getByRole("button", { name: "Continue in it" }).click();

  // A Word file is revised from the change itself, by a new upload.
  await expect(page).toHaveURL(/\/-\/changes\/\d+$/);
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible({
    timeout: 30_000,
  });
});
