/**
 * The signed-in person's own account, at `/-/user_settings/profile`.
 *
 * A name is what the record writes, so it is asked for at signup and can be
 * changed here — and the account menu says it, with the login beneath.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<{ username: string; session: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `account-${suffix}`;
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Jordan",
      lastName: "Kim",
      username,
      email: `${username}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(200);
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  return { username, session };
}

test("signup refuses an account with no name", async () => {
  const suffix = randomUUID().slice(0, 12);
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: `noname-${suffix}`,
      email: `noname-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Enter your first and last name.");
});

test("a name given at signup is the name the app uses, and can be changed", async ({
  page,
}) => {
  const { username, session } = await signUp();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);

  await page.goto(`${APP_BASE_URL}/`);
  await page.getByRole("button", { name: `User: ${username}` }).click();
  const menu = page.getByRole("menu", { name: "Account menu" });
  await expect(menu.getByText("Jordan Kim")).toBeVisible();
  await expect(menu.getByText(`@${username}`)).toBeVisible();

  await menu.getByRole("menuitem", { name: "Your account" }).click();
  await expect(page).toHaveURL(/\/-\/user_settings\/profile$/);
  await expect(page.getByLabel("First name")).toHaveValue("Jordan");
  await expect(page.getByLabel("Last name")).toHaveValue("Kim");

  await page.getByLabel("First name").fill("Jordana");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  // Everywhere that names them catches up without a reload.
  await page.getByRole("button", { name: `User: ${username}` }).click();
  await expect(menu.getByText("Jordana Kim")).toBeVisible();
});
