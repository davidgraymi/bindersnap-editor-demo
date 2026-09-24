/**
 * Everything one change does, on one screen.
 *
 * ADR 0004: "the unit of approval is the change, not the document." A reviewer
 * approves a change, so the question they open one with is what the *change*
 * does — and the only way to answer it was to pick a document out of a list,
 * read its comparison, come back, and pick the next. That is the "which
 * version did we approve?" problem the product exists to end, moved one level
 * up.
 *
 * **Integration rather than unit, because every claim here is about refs.**
 * The wording is unit-tested in `changedDocuments.test.ts` and the rendering
 * in `ChangeComparisonPage.test.ts`; what neither can be wrong about
 * convincingly is whether a real comparison reads at two real refs. Two of
 * these cases exist precisely because a mock would have passed:
 *
 * - **A renamed policy.** The identity survives a rename and the address does
 *   not (ADR 0005), so reading by address 404s at the base ref — on exactly
 *   the change this screen exists to explain. The diff came back "a browser
 *   cannot read inside these files" until the read went by identity.
 * - **A removal.** Gitea reports a rename as a delete plus an add, so the
 *   removed half of a change's file list calls every rename an archiving
 *   unless the UIDs that came back on the other side are subtracted. A page
 *   that told a compliance customer a document had left the binder when it
 *   only moved folder is worse than one that said nothing.
 *
 * Both read the seeded binders rather than building a change, because the seed
 * already holds the two states and building them here would be asserting
 * against the same code that wrote them.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 180_000 });

/** `?view=compare` — its own address, so a reviewer can send the diff. */
function comparisonUrl(binder: string, change: number): string {
  return `${APP_BASE_URL}/${OWNER}/${binder}?tab=changes&change=${change}&view=compare`;
}

test("the change's own list is the way in, and it names the screen", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/${OWNER}/facilities?tab=changes&change=4`);

  // In the list's own bar, beside the count — not floating on the paper above
  // it, which is the rule that makes the binder's screens read as one product.
  const link = page.getByRole("button", {
    name: /See everything that changed/,
  });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(/view=compare/);
  // Both documents, on one screen, without picking either.
  await expect(page.locator(".cmp-file")).toHaveCount(2);
  await expect(page.locator(".bs-rail .bs-row")).toHaveCount(2);
});

test("a renamed policy is read by identity, not by address", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("clinical", 19));

  // The rename itself, drawn in the file's bar as a diff draws a changed
  // line: the old path struck out, the new one beside it.
  await expect(page.locator(".cmp-file-title del").first()).toContainText(
    "patient-grievance-policy",
  );
  await expect(page.locator(".cmp-file-title ins").first()).toBeVisible();

  /**
   * **The diff actually read.** This is the assertion the bug would have
   * failed: the document is at `administrative/complaints/…` on the change's
   * branch and at `administrative/patient-grievance-policy` on the base, so a
   * read by address finds nothing at one of the two refs and the screen
   * reports the file unreadable rather than showing the change.
   */
  await expect(page.locator(".cmp-file del").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".cmp-file ins").first()).toBeVisible();
  await expect(page.locator(".cmp-scale")).not.toContainText(
    "a browser cannot read inside these files",
  );
});

test("a document taken off the record says so, and offers what is coming off", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("corporate", 20));

  // The change publishes no version at all, so the old screen — which was
  // scoped to one versioned document — had nothing to show for it.
  await expect(page.locator(".cmp-kind--removed")).toContainText(
    "Taken off the record",
  );
  await expect(page.locator(".cmp-removed-line")).toContainText(
    "Nothing is lost",
  );

  // Not a diff: a removal has no file on the branch. What it has is the last
  // version on record, which is the honest thing to offer instead.
  await expect(
    page.locator(".cmp-file").getByRole("button", { name: "Download" }),
  ).toBeVisible();
  await expect(
    page.locator(".cmp-file").getByRole("link", { name: "View" }),
  ).toHaveCount(0);
});

test("a change that versions nothing says what it does instead", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("governance", 7));

  // A sign-off rules change goes through the same review as a policy and
  // publishes no version, so every word about versions would be false for it.
  await expect(page.locator(".bs-note")).toContainText("versions no document");
  await expect(page.locator(".cmp-file")).toHaveCount(0);
  // Nothing to size is not a size.
  await expect(page.locator(".cmp-scale")).toHaveCount(0);
});

test("ticking a document as viewed keeps your place, in this tab only", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("facilities", 4));

  await expect(page.locator(".cmp-file")).toHaveCount(2);
  await page.locator(".cmp-file .cmp-file-read").first().click();

  await expect(page.locator(".cmp-rail-row--read")).toHaveCount(1);
  await expect(page.locator(".cmp-tree-progress")).toHaveText("1 of 2 viewed");

  // A bookmark for this sitting, in this tab, about this change — and never
  // anything the server hears about.
  const stored = await page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith("bindersnap:compare-read:"),
    ),
  );
  expect(stored).toEqual([`bindersnap:compare-read:${OWNER}/facilities#4`]);
});

test("folding a document keeps its bar, and every act in it", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("facilities", 4));

  const first = page.locator(".cmp-file").first();
  await expect(first.locator(".cmp-file-body")).toBeVisible();

  await first.locator(".cmp-file-fold").click();

  // An author rule beats the user agent's `[hidden]`, which is why folding did
  // nothing until the stylesheet said so.
  await expect(first.locator(".cmp-file-body")).toBeHidden();
  // Every act on a document lives in its one bar, so folding it away hides
  // the document and leaves the way to view or download it.
  await expect(
    first.locator(".cmp-file-head").getByRole("link", { name: "View" }),
  ).toHaveAttribute("href", /\?ref=.*&change=4/);
  await expect(
    first.locator(".cmp-file-head").getByRole("button", { name: "Download" }),
  ).toBeVisible();
});

test("the branch and View both lead to the file on the change's branch", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(comparisonUrl("clinical", 19));

  // The branch under the title is a place, so it goes somewhere: the binder
  // read at that branch, opened on the change's first document.
  const branch = page.locator("a.cmp-branch");
  await expect(branch).toBeVisible();
  const href = await branch.getAttribute("href");
  expect(href).toMatch(/\?ref=.+&change=19$/);

  // View in the file's bar is the same address for that one file — a real
  // link, so it can be opened in a new tab or sent to somebody.
  const view = page
    .locator(".cmp-file-head")
    .first()
    .getByRole("link", { name: "View" });
  await expect(view).toHaveAttribute("href", href!);

  await branch.click();
  await expect(page).toHaveURL(
    /\/clinical\/administrative\/complaints\/patient-complaints-policy\?ref=/,
  );
});
