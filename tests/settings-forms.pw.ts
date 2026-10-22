import { expect, test } from "@playwright/test";

import { signInAsAlice } from "./helpers";

// The People tab reads the organization's members, teams and invitations
// before the form draws, which on a loaded runner uses up the suite's 10s
// default by itself.
test.describe.configure({ timeout: 45_000 });

/**
 * A settings form is sized like the rest of the app, not like the landing page.
 *
 * The People page's "Add someone" and "New group" forms used the full-size
 * input — 49px tall, and as wide as the 860px column — under a list whose own
 * controls are 32px. A name typed into it read as a paragraph to be written.
 */
test("a settings form keeps the app's control size and a measure", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto("/riverside-health?tab=people");

  const form = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "New group" }) });
  const name = form.getByRole("textbox", { name: "Name" });
  const create = form.getByRole("button", { name: "Create group" });
  await expect(name).toBeVisible({ timeout: 30_000 });

  const box = await name.boundingBox();
  const button = await create.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(36);
  expect(button!.height).toBeLessThanOrEqual(36);
  expect(box!.width).toBeLessThanOrEqual(32 * 16);
});
