/**
 * Quick find reaches binders and people, not only policies.
 *
 * It searched documents alone, which made it a shortcut rather than a way to
 * get anywhere: the fastest route to a binder was still to remember which
 * organization owned it, and the fastest route to a person was to open a
 * binder they happened to be in. A command palette that reaches one kind of
 * thing is a filter with a keyboard shortcut.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";
import { seedDevStack } from "./seed";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await seedDevStack();
});

/** Open the palette and ask it something. */
async function ask(page: import("@playwright/test").Page, query: string) {
  // The trigger, not the chord: ⌘K does open it, but Meta does not map
  // reliably in headless Chromium and this test is about what the panel
  // searches, not about the shortcut. The shortcut has its own test below.
  await page.locator(".app-nav-search-trigger").click();
  // A combobox, not a textbox — it drives the result listbox below it.
  const field = page.getByRole("combobox", {
    name: "Search binders, policies, or people",
  });
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(query);

  // The panel debounces, then asks three sources. Waiting for it to settle
  // rather than sleeping a fixed time: under the load of the whole suite those
  // three requests take longer than any sleep worth writing, and a fixed wait
  // plus a default 5s assertion is how this failed only in a full run.
  await expect(
    page
      .locator(".quick-find-dialog")
      .locator(".quick-find-group, .quick-find-empty, .quick-find-note"),
  ).not.toHaveCount(0, { timeout: 30_000 });
}

test("one query reaches policies, binders and people at once", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  // "cl" matches the Clinical binder and the policies filed in it.
  await ask(page, "cl");

  const dialog = page.locator(".quick-find-dialog");
  await expect(dialog.locator(".quick-find-group")).toContainText(
    ["Policies", "Binders"],
    { timeout: 30_000 },
  );
  await expect(
    dialog.getByRole("option", { name: /Infection Control Policy/ }),
  ).toBeVisible();
  await expect(dialog.getByRole("option", { name: /^Clinical/ })).toBeVisible();
});

test("a person is findable by name and by username", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  await ask(page, "bob");

  const dialog = page.locator(".quick-find-dialog");
  await expect(dialog.locator(".quick-find-group")).toContainText(["People"], {
    timeout: 30_000,
  });
  // Shown by name, disambiguated by username — the case for two people called
  // Bob, which the username is on the line to answer.
  await expect(
    dialog.getByRole("option", { name: /Bob Okafor/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: /Bob Okafor/ }),
  ).toContainText("bob");
});

test("picking a binder opens the binder", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  await ask(page, "clinical");
  await page
    .locator(".quick-find-dialog")
    .getByRole("option", { name: /^Clinical/ })
    .click();

  await expect(page).toHaveURL(/\/riverside-health\/clinical$/, {
    timeout: 30_000,
  });
  await expect(page.getByRole("tab", { name: "Documents" })).toBeVisible();
});

test("picking a person opens the organization's people", async ({ page }) => {
  // There is no page for one person, so the question "who is this" is answered
  // where every question about somebody is answered.
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  await ask(page, "carol");
  await page
    .locator(".quick-find-dialog")
    .getByRole("option", { name: /Carol/ })
    .click();

  await expect(page).toHaveURL(/\/riverside-health\?tab=people$/, {
    timeout: 30_000,
  });
});

test("the shortcut the panel advertises is the one this audience knows", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  // Both "/" and ⌘K have always opened it. The hint is the half a reader
  // learns from, and "/" is a reflex from vim and GitHub.
  await expect(page.locator(".app-nav-search-kbd")).toHaveText("⌘K");

  // "/" still works, and is deliberately not advertised.
  await page.keyboard.press("/");
  await expect(
    page.getByRole("combobox", {
      name: "Search binders, policies, or people",
    }),
  ).toBeVisible({ timeout: 30_000 });
});
