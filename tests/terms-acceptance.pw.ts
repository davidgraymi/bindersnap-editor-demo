/**
 * Accepting the Terms after signup (#666): an account with no agreement on
 * the current version is stopped before anything else, and let through once
 * it accepts.
 *
 * Signup and creating an organization record agreement on their own, so the
 * account here is made in Gitea directly, the way an account from before the
 * Terms, or one whose Terms changed materially, arrives.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  GITEA_ADMIN_PASS,
  GITEA_ADMIN_USER,
  GITEA_URL,
} from "./helpers";

async function createAccountWithNoAgreement(): Promise<{
  username: string;
  password: string;
}> {
  const username = `terms-${randomUUID().slice(0, 8)}`;
  const password = `Pw-${randomUUID()}`;
  const response = await fetch(`${GITEA_URL}/api/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${GITEA_ADMIN_USER}:${GITEA_ADMIN_PASS}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
      email: `${username}@example.com`,
      full_name: "Terms Tester",
      must_change_password: false,
      send_notify: false,
    }),
  });
  expect(response.status, await response.text()).toBe(201);
  return { username, password };
}

test("an account with nothing on record accepts the Terms before going on", async ({
  page,
}) => {
  const account = await createAccountWithNoAgreement();

  await page.goto("/-/login");
  await page.getByLabel("Username or Email").fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Open workspace" }).click();

  await expect(
    page.getByRole("heading", { name: "Accept our updated Terms." }),
  ).toBeVisible({ timeout: 30_000 });
  const terms = page.getByRole("link", { name: "Terms of Service" });
  await expect(terms).toHaveAttribute("href", "/legal/terms");

  // Not without the box.
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(
    page.getByText("Tick each box to accept the Terms and go on."),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Accept our updated Terms." }),
  ).toBeHidden();

  // Recorded, so a fresh load does not ask again.
  await page.reload();
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${account.username}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Accept our updated Terms." }),
  ).toHaveCount(0);

  const status = await page.request.get(`${API_BASE_URL}/api/app/legal`);
  expect(await status.json()).toMatchObject({
    person: false,
    organizations: [],
  });
});
