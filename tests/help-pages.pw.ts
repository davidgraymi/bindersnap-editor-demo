/**
 * Help is ordinary pages anybody can read — signed in or not, a person or an
 * AI agent — and the app opens it in a new tab rather than inside a binder.
 */
import { expect, test } from "@playwright/test";

import { APP_BASE_URL, signInAsAlice } from "./helpers";

test("anybody can read help, and move between the guides on their own", async ({
  page,
}) => {
  await page.goto(`${APP_BASE_URL}/help`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Help and guides" }),
  ).toBeVisible();
  // Not the app: no sign-in, no sidebar, no binder.
  await expect(page.getByText("Your work")).toHaveCount(0);
  await expect(page.getByLabel("Username or Email")).toHaveCount(0);

  await page
    .getByRole("main")
    .getByRole("link", { name: /How a change becomes the record/ })
    .click();
  await expect(page).toHaveURL(/\/help\/approvals$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "How many approvals" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Guides" })
      .getByRole("link", { name: "How a change becomes the record" }),
  ).toHaveAttribute("aria-current", "page");

  // Onward without going back to the list.
  await page.locator('a[rel="next"]').click();
  await expect(page).toHaveURL(/\/help\/[a-z-]+$/);
  await expect(page).not.toHaveURL(/\/help\/approvals$/);

  await page.getByRole("link", { name: "All guides" }).click();
  await expect(page).toHaveURL(/\/help$/);
});

test("an agent can read the guides as text", async ({ request }) => {
  const index = await request.get(`${APP_BASE_URL}/llms.txt`);
  expect(index.status()).toBe(200);
  const text = await index.text();
  expect(text).toContain("# Bindersnap Help");
  expect(text).toContain("(/help/approvals.md)");

  const guide = await request.get(`${APP_BASE_URL}/help/approvals.md`);
  expect(guide.status()).toBe(200);
  expect(guide.headers()["content-type"]).toContain("text/markdown");
  expect(await guide.text()).toMatch(/^# How a change becomes the record/);

  const page = await request.get(`${APP_BASE_URL}/help/approvals`);
  // The words are in the page as served, with nothing to run first.
  expect(await page.text()).toContain("<h2>How many approvals</h2>");

  expect(
    (await request.get(`${APP_BASE_URL}/help/no-such-guide`)).status(),
  ).toBe(404);
});

test("the app opens help in a new tab", async ({ page }) => {
  await signInAsAlice(page);
  const help = page.getByRole("link", { name: /Help and guides/ });
  await expect(help).toHaveAttribute("target", "_blank");

  const [tab] = await Promise.all([
    page.context().waitForEvent("page"),
    help.click(),
  ]);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/help$/);
  await expect(
    tab.getByRole("heading", { level: 1, name: "Help and guides" }),
  ).toBeVisible();
  // The app stays where it was.
  await expect(page).not.toHaveURL(/\/help/);
});
