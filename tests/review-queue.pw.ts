/**
 * The review queue — every change in flight, across every binder.
 *
 * The screen the product was missing. Home is a to-do list that drops the
 * changes moving without you, and a binder's Change requests tab can only
 * answer for one binder. The thing to prove here is the thing neither of those
 * does: one list, more than one binder, and counters that agree with it.
 *
 * Runs against the seeded fixture rather than building its own, because the
 * seed already has changes in two binders in several different states, which
 * is exactly the shape this page exists to show.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.beforeAll(async () => {
  await seedDevStack();
});

test("the queue gathers changes from every binder into one list", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/changes`);

  await expect(
    page.getByRole("heading", { name: "Change requests" }),
  ).toBeVisible({ timeout: 30_000 });

  // Show everything, whichever filter the page opened on.
  await page
    .locator(".queue-counters")
    .getByRole("button", { name: /All changes/ })
    .click();

  const rows = page.locator(".queue-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  // **The point of the page.** Both seeded binders are represented, which is
  // what no other screen in the app can show at once.
  const meta = page.locator(".queue-row-meta");
  await expect(meta.filter({ hasText: "Clinical" }).first()).toBeVisible();
  await expect(meta.filter({ hasText: "Corporate" }).first()).toBeVisible();

  // A row names the document, not just the binder it is filed in.
  await expect(
    meta.filter({ hasText: "Infection Control Policy" }).first(),
  ).toBeVisible();
});

test("the counters are the filters, and they agree with the list", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/changes`);
  await expect(
    page.getByRole("heading", { name: "Change requests" }),
  ).toBeVisible({ timeout: 30_000 });

  // Every counter shows the number of rows pressing it produces. A number you
  // cannot press is a number you have to go somewhere else to act on, and a
  // number that disagrees with its own list is worse than no number.
  for (const label of [
    "All changes",
    "Waiting on you",
    "In review",
    "Ready to publish",
    "Blocked",
  ] as const) {
    // Scoped to the counter group on purpose: a row carrying the "Waiting on
    // you" flag has the same accessible name as the counter that filters to it.
    const counter = page
      .locator(".queue-counters")
      .getByRole("button", { name: new RegExp(label) });
    const shown = Number(
      (await counter.locator(".queue-counter-value").innerText()).trim(),
    );

    await counter.click();
    await expect(counter).toHaveAttribute("aria-pressed", "true");

    if (shown === 0) {
      await expect(page.locator(".queue-row")).toHaveCount(0);
    } else {
      await expect(page.locator(".queue-row")).toHaveCount(shown, {
        timeout: 30_000,
      });
    }
  }
});

test("a row opens the change it names", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/changes`);
  await page
    .locator(".queue-counters")
    .getByRole("button", { name: /All changes/ })
    .click();

  const firstRow = page.locator(".queue-row-btn").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const title = (await firstRow.locator(".queue-row-title").innerText()).trim();

  await firstRow.click();

  // It lands inside the binder, on that change — not on a list of changes.
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 30_000,
  });
  const url = new URL(page.url());
  expect(url.searchParams.get("tab")).toBe("changes");
  expect(url.searchParams.get("change")).not.toBeNull();
});

test("the queue keeps the build's status words, not a state name", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/changes`);
  await page
    .locator(".queue-counters")
    .getByRole("button", { name: /All changes/ })
    .click();
  await expect(page.locator(".queue-row").first()).toBeVisible({
    timeout: 30_000,
  });

  // "Carol Mendes asked for changes" beats "Blocked": it says who, and it says
  // what would unblock it. The seed has one of these waiting.
  await expect(
    page.locator(".queue-row-reason").filter({ hasText: /asked for changes/ }),
  ).not.toHaveCount(0);

  // And a ready change says which version publishing it produces.
  await expect(
    page.locator(".queue-row-reason").filter({ hasText: /becomes v\d/ }),
  ).not.toHaveCount(0);
});
