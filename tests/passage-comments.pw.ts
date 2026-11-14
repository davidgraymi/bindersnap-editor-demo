/**
 * Commenting on the words of a document, from the change's Changes tab.
 *
 * A reviewer selects words, comments on them, and the comment is an ordinary
 * discussion on the change that remembers the passage: it is listed under the
 * document, marked in it, and shown with its quote in the Overview.
 */
import { expect, test } from "@playwright/test";

import { APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

// Several pages read in turn, on a CI runner shared with every other suite:
// the suite default of ten seconds is for one page.
test.describe.configure({ timeout: 120_000 });

// The seed's one open change in Safety: "Add the bariatric equipment section".
const CHANGE = `${APP_BASE_URL}/${OWNER}/safety/-/changes/3`;

test("words selected in a document can be commented on, and the comment remembers them", async ({
  page,
}) => {
  const said = `Is this the current wording? ${Date.now()}`;

  await signInAsAlice(page);
  await page.goto(`${CHANGE}/diffs`);
  const sheet = page.locator(".cmp-file .doc-preview-prose").first();
  await expect(sheet).toBeVisible({ timeout: 30_000 });

  // Nothing is offered until words are selected.
  await expect(
    page.getByRole("button", { name: "Comment", exact: true }),
  ).toHaveCount(0);

  // Select the first real word, as a person's drag would, and let go. A
  // double click at a paragraph's middle can land between two words, which
  // selects nothing.
  await sheet.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const match = /[A-Za-z]{4,}/.exec(node.textContent ?? "");
      if (!match) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      node.parentElement!.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true }),
      );
      return;
    }
  });
  const quoted = (
    await page.evaluate(() => window.getSelection()?.toString() ?? "")
  ).trim();
  expect(quoted.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const box = page.getByRole("form", { name: "Comment on this passage" });
  await expect(box.locator("blockquote")).toContainText(quoted);
  await box.getByLabel("Your comment").fill(said);
  await box.getByRole("button", { name: "Comment", exact: true }).click();

  // Listed under the document, with the words it is about.
  const list = page.getByRole("region", { name: "Comments on this document" });
  const item = list.locator("li", { hasText: said });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(item.locator(".passage-quote")).toContainText(quoted);
  await expect(item).toContainText("Open");

  // And marked in the document itself, without touching its markup.
  expect(
    await page.evaluate(() => {
      const registry = (
        CSS as unknown as { highlights?: Map<string, { size: number }> }
      ).highlights;
      return registry?.get("bs-passage")?.size ?? 0;
    }),
  ).toBeGreaterThan(0);
  await expect(sheet.locator("mark")).toHaveCount(0);

  // It is a discussion on the change like any other: the Overview has it,
  // with the passage, and it can be resolved there.
  await item.getByRole("link", { name: "Reply or resolve" }).click();
  await expect(page).toHaveURL(/\/-\/changes\/3#thread-/);
  const thread = page
    .getByTestId("discussion-thread")
    .filter({ hasText: said });
  await expect(thread).toBeVisible({ timeout: 30_000 });
  await expect(thread.locator(".rev-thread-passage")).toContainText(quoted);
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(thread).toContainText("Resolved", { timeout: 30_000 });

  // Back in the document it is still listed, as settled.
  await page.goto(`${CHANGE}/diffs`);
  await expect(
    page
      .getByRole("region", { name: "Comments on this document" })
      .locator("li", { hasText: said }),
  ).toContainText("Resolved", { timeout: 30_000 });
});
