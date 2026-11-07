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

// Serial, and given room: the whole suite's files run in parallel, and these
// read the seeded fixture rather than building their own.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  // The hook has its own budget, and describe.configure's timeout does not
  // reach it. Seeding is idempotent but not instant on a loaded runner, and a
  // 10s hook fails the suite before a single assertion has run.
  test.setTimeout(90_000);
  await seedDevStack();
});

const SECTIONS = [
  "Waiting on your review",
  "Changes requested",
  "Ready to publish",
  "In review",
] as const;

test("the queue gathers changes from every binder, a section per state", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/changes`);

  await expect(
    page.getByRole("heading", { name: "Change requests", level: 1 }),
  ).toBeVisible({ timeout: 30_000 });

  // Every state has a place on the page, in the order somebody acts on them,
  // whether or not anything is in it yet — then what was decided lately.
  await expect(page.locator(".queue-section .bs-panel-bar-title")).toHaveText(
    [...SECTIONS, "Recently decided"],
    { timeout: 30_000 },
  );

  const rows = page.locator(".change-row");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  // **The point of the page.** Both seeded binders are represented, which is
  // what no other screen in the app can show at once.
  const meta = page.locator(".bs-row-meta");
  await expect(meta.filter({ hasText: "Clinical" }).first()).toBeVisible();
  await expect(meta.filter({ hasText: "Corporate" }).first()).toBeVisible();

  // A row says who asked and when, and does not name a document. A change can
  // touch three; naming one of them is a claim about the other two.
  await expect(
    page
      .locator(
        ".queue-section--in_review .bs-row-meta, .queue-section--ready .bs-row-meta, .queue-section--your_review .bs-row-meta, .queue-section--changes_requested .bs-row-meta",
      )
      .first(),
  ).toHaveText(/#\d+ · \S+.* (opened|· updated) /);
});

test("every change has one home, and each count is its section's rows", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/changes`);
  await expect(page.locator(".change-row").first()).toBeVisible({
    timeout: 30_000,
  });

  // A change ready to publish used to be "Waiting on you" as well, so it was
  // listed twice. Now no change is in two sections, and each section's count
  // is the number of rows in it — read in one tick, because other files of
  // this suite publish Alice's changes while it runs.
  await expect
    .poll(
      async () =>
        page.evaluate(
          (labels) => {
            const keys: string[] = [];
            const mismatched: string[] = [];
            for (const section of document.querySelectorAll(".queue-section")) {
              const label = section.getAttribute("aria-label") ?? "";
              if (!labels.includes(label)) continue;
              const rows = section.querySelectorAll(".change-row");
              const count = Number(
                section.querySelector(".bs-section-count")?.textContent ?? "-1",
              );
              if (count !== rows.length) mismatched.push(label);
              for (const row of rows) {
                keys.push(row.querySelector("a")?.getAttribute("href") ?? "");
              }
            }
            return {
              mismatched,
              duplicated: keys.length - new Set(keys).size,
            };
          },
          [...SECTIONS],
        ),
      { timeout: 30_000 },
    )
    .toEqual({ mismatched: [], duplicated: 0 });
});

test("a row opens the change it names", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/changes`);

  const firstRow = page.locator(".change-row-open").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  const title = (
    await firstRow.locator(".change-row-title").innerText()
  ).trim();

  await firstRow.click();

  // It lands inside the binder, on that change — not on a list of changes.
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 30_000,
  });
  expect(new URL(page.url()).pathname).toMatch(/\/-\/changes\/\d+$/);
});

test("a row's standing is one word, and the row says nothing else", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/-/changes`);
  await expect(page.locator(".change-row").first()).toBeVisible({
    timeout: 30_000,
  });

  // **The customer's instruction, as an assertion.** *"KEEP IT STUPID
  // SIMPLE."* So: a word a reader already knows, and nothing arithmetic
  // beside it.
  const standings = page.locator(".change-row .change-standing");
  await expect(standings.first()).toBeVisible();

  for (const text of await standings.allInnerTexts()) {
    expect([
      "Awaiting approval",
      "Changes requested",
      "Approved",
      "Published",
      "Closed",
    ]).toContain(text.trim());
  }

  // Whose turn it is is the section a row is in, never words on the row.
  await expect(
    page.locator(".change-row").getByText(/Waiting on|approvals|becomes v/),
  ).toHaveCount(0);
});
