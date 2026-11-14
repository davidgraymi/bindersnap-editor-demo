/**
 * "Who signs off here", on the pages that show a place in a binder, and a
 * folder as a place with an address.
 *
 * Against the seeded Governance binder: Clinical Standards carries its own
 * rule (Infection Control), and the binder's own rule (Policy Office) applies
 * to everything. Read-only, so it runs against the shared seed.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import { APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

const BINDER = `${APP_BASE_URL}/${OWNER}/governance`;

test.describe.configure({ mode: "parallel", timeout: 120_000 });

test("a folder's page says who signs off there, and where each rule is set", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Clinical Standards" }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "Who signs off here" });
  await expect(panel).toBeVisible();

  const setHere = panel.locator(".bs-row-list").first();
  await expect(setHere).toContainText("Infection Control");
  await expect(setHere).toContainText("Set on this folder");
  await expect(panel).toContainText("From above");
  await expect(panel).toContainText("Policy Office");

  // The origin link opens the binder, where the rule is set.
  await panel.getByRole("link", { name: "Governance" }).first().click();
  await expect(page).toHaveURL(`${BINDER}`);
  await expect(
    page
      .getByRole("region", { name: "Who signs off here" })
      .locator(".bs-row-list")
      .first(),
  ).toContainText("Any change to who signs off");
});

test("a folder's name opens its page; its arrow opens it in place", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);
  const files = page.getByRole("complementary", { name: /Files in/ });

  // The arrow: Contracts opens in the panel, and the page stays put.
  await files.getByRole("button", { name: "Open Contracts here" }).click();
  await expect(
    files.getByRole("button", { name: "Shut Contracts" }),
  ).toBeVisible();
  await expect(page).toHaveURL(`${BINDER}/-/tree/main/clinical-standards`);

  // The name: Contracts' page.
  await files.getByRole("link", { name: "Contracts" }).click();
  await expect(page).toHaveURL(`${BINDER}/-/tree/main/contracts`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Contracts" }),
  ).toBeVisible();

  // Keyboard: Left shuts it from its row, Enter follows the link.
  const link = files.getByRole("link", { name: "Clinical Standards" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${BINDER}/-/tree/main/clinical-standards`);
});

test("a document's rail leads with who signs off, mostly from above", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(`${BINDER}/-/blob/main/clinical-standards/hand-hygiene`);
  const panel = page.getByRole("region", { name: "Who signs off here" });
  await expect(panel).toContainText("Nothing is set on this document alone.");
  await expect(panel).toContainText("Infection Control");
  await panel.getByRole("link", { name: "Clinical Standards" }).click();
  await expect(page).toHaveURL(`${BINDER}/-/tree/main/clinical-standards`);
});

test("a folder that is not there says so", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(`${BINDER}/-/tree/main/no-such-folder`);
  await expect(page.getByText("No such folder.")).toBeVisible();
});
