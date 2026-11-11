/**
 * A Word file becomes a Bindersnap document, in the author's draft.
 *
 * **What this is proving.** That a file the editor cannot open is not a dead
 * end (issue 883): "Edit in Bindersnap" reads it, says what a conversion
 * loses before anything is written, and then writes the converted document
 * into the author's draft as the next version of the same document — the
 * identity segment of its filename kept, the original left on the record. The
 * conversion itself is unit-tested in `apps/app/convertToEditor.test.ts`; what
 * only a browser and a server can say is that the file really is replaced in
 * the draft and the editor opens on it.
 *
 * Uses the seeded Infection Control Policy, a real .docx in the clinical
 * binder, and discards the draft it opened so the seed is as it was found.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import { OWNER, signInAsAlice } from "./helpers";

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const DOCUMENT = `/${OWNER}/clinical/-/blob/main/nursing/infection-control-policy`;

test("a Word file is converted into the draft and opens in the editor", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(DOCUMENT);

  // Edit opens the editor on it, shown as it is, and its note offers the
  // conversion.
  await page
    .locator(".bs-pagehead-actions")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page
    .getByRole("complementary", { name: "About this file" })
    .getByRole("button", { name: "Edit in Bindersnap" })
    .click({ timeout: 60_000 });

  // Read first, written second: the dialog says what is lost before it costs
  // anything, and Convert is not available until the file has been read.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Page layout")).toBeVisible({
    timeout: 60_000,
  });
  await dialog.getByRole("button", { name: "Convert and edit" }).click();

  // The editor is open on the same document, now one it writes.
  await expect(page).toHaveURL(/edit=write/, { timeout: 60_000 });
  await expect(page).toHaveURL(/infection-control-policy/);
  await expect(page.locator(".ProseMirror")).toContainText(/infection/i, {
    timeout: 60_000,
  });

  // The file panel lists it as a policy now, not as an uploaded file.
  const row = page.locator(".doc-files-item[aria-current='page']");
  await expect(row).toContainText("Infection Control Policy");
  await expect(row).not.toHaveClass(/doc-files-item--file/);

  // Leave the seed as it was found.
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".draft-bar-discard")).toHaveCount(0, {
    timeout: 30_000,
  });
});
