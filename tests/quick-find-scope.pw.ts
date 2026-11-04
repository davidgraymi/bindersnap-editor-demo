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
    name: "Search Bindersnap",
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

test("one query reaches documents, binders and people at once", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  // "cl" matches the Clinical binder and the policies filed in it.
  await ask(page, "cl");

  const dialog = page.locator(".quick-find-dialog");
  await expect(dialog.locator(".quick-find-group")).toContainText(
    ["Documents", "Binders"],
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
  // The binder's own section of the sidebar is how you know you are in one.
  await expect(page.locator(".app-sidebar-binder-name")).toHaveText("Clinical");
});

test("picking a person copies their username, and says so", async ({
  page,
  context,
}) => {
  // There is no page for one person, and somebody in two organizations has
  // no one People page. What a person looked up is needed for next is a
  // username to paste — into a review request, a binder, a group.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  await ask(page, "carol");
  const carol = page
    .locator(".quick-find-dialog")
    .getByRole("option", { name: /Carol/ });
  await carol.hover();
  await expect(carol).toContainText("Enter copies the username");
  await carol.click();

  // The panel stays where it was, and the row says what happened.
  await expect(carol).toContainText("Copied carol", { timeout: 10_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "carol",
  );
});

test("change requests and organizations are found too", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(APP_BASE_URL);

  // A change request by its title, opened on its own binder.
  await ask(page, "supplier terms");
  const dialog = page.locator(".quick-find-dialog");
  await expect(dialog.locator(".quick-find-group")).toContainText(
    ["Change requests"],
    { timeout: 30_000 },
  );
  const change = dialog
    .getByRole("option", { name: /Retire the 2019 supplier terms/ })
    .first();
  await expect(change).toContainText("Corporate · #");
  await change.click();
  await expect(page).toHaveURL(
    /\/riverside-health\/corporate\/-\/changes\/\d+$/,
    {
      timeout: 30_000,
    },
  );

  // An organization by its name.
  await ask(page, "riverside");
  await dialog
    .getByRole("option", { name: /Riverside Health/ })
    .filter({ hasText: "Organization" })
    .click();
  await expect(page).toHaveURL(/\/riverside-health$/, { timeout: 30_000 });
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
      name: "Search Bindersnap",
    }),
  ).toBeVisible({ timeout: 30_000 });
});

test("Bindersnap's own pages and controls are found too", async ({
  page,
  context,
}) => {
  await signInAsAlice(page);
  await page.goto(`${APP_BASE_URL}/riverside-health/clinical`);
  const dialog = page.locator(".quick-find-dialog");
  const field = page.getByRole("combobox", { name: "Search Bindersnap" });

  // "help" is Help and guides, which opens beside the app as the menus open it.
  await ask(page, "help");
  const help = dialog.getByRole("option").first();
  await expect(help).toContainText("Help and guides", { timeout: 30_000 });
  const [helpTab] = await Promise.all([
    context.waitForEvent("page"),
    help.click(),
  ]);
  expect(new URL(helpTab.url()).pathname).toBe("/help");
  await helpTab.close();

  // A control does what it says, and the next search offers the way back.
  const theme = () =>
    page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const before = await theme();
  await ask(page, "theme");
  await field.press("ArrowDown");
  await field.press("Enter");
  await expect.poll(theme).not.toBe(before);

  await ask(page, "collapse");
  await expect(dialog.getByRole("option").first()).toContainText(
    "Collapse the navigation",
  );
  await field.press("ArrowDown");
  await field.press("Enter");
  await expect(page.locator(".app-sidebar")).toHaveClass(
    /app-sidebar--collapsed/,
  );
  await ask(page, "sidebar");
  await expect(dialog.getByRole("option").first()).toContainText(
    "Expand the navigation",
  );
  await field.press("ArrowDown");
  await field.press("Enter");
  await expect(page.locator(".app-sidebar")).not.toHaveClass(
    /app-sidebar--collapsed/,
  );

  // A page is a place, like any other result.
  await ask(page, "billing");
  await field.press("ArrowDown");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/riverside-health\/-\/billing$/);
});
