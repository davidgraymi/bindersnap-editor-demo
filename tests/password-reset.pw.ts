/**
 * "Forgot password?" end to end: the form, the email, the link, the reset.
 *
 * The API sends the email through its outbox, and the local stack delivers it
 * to Mailpit (tests/mailpit.ts), so this test does what a locked-out person
 * does — opens the email and follows the link.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { countEmails, signUpAndConfirm, waitForEmail } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<{
  username: string;
  email: string;
  password: string;
  session: string;
}> {
  const suffix = randomUUID().slice(0, 12);
  const username = `reset-${suffix}`;
  const email = `${username}@users.bindersnap.local`;
  const password = `Bindersnap-${suffix}!`;
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Jordan",
      lastName: "Kim",
      username,
      email,
      password,
    }),
  });
  expect(response.status).toBe(200);
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  return { username, email, password, session };
}

async function me(session: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Cookie: `bindersnap_session=${session}` },
  });
  return response.status;
}

test("a locked-out person resets their password from the emailed link", async ({
  page,
}) => {
  const account = await signUp();

  await page.goto(`${APP_BASE_URL}/-/login`);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/-\/forgot_password$/);
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(account.email);

  const email = await waitForEmail(
    account.email,
    /Reset your Bindersnap password/,
  );
  expect(email.from).toContain("Bindersnap");
  const link = email.links.find((href) => href.includes("/-/reset_password"));
  expect(link).toBeDefined();
  expect(link!.startsWith(`${APP_BASE_URL}/-/reset_password?token=`)).toBe(
    true,
  );

  await page.goto(link!);
  // The token is a credential: read, then out of the address bar.
  await expect(page).toHaveURL(/\/-\/reset_password$/);
  await expect(
    page.getByText(`For the account ${account.username}.`),
  ).toBeVisible();

  const newPassword = `Changed-${randomUUID().slice(0, 8)}!`;
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save and sign in" }).click();

  // Signed in, somewhere in the app.
  await expect(page).not.toHaveURL(/reset_password|login/);

  // Every session they had before is gone.
  expect(await me(account.session)).toBe(401);

  // The old password no longer works, the new one does.
  const login = (password: string) =>
    fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
      body: JSON.stringify({ username: account.username, password }),
    });
  expect((await login(account.password)).status).toBe(401);
  expect((await login(newPassword)).status).toBe(200);

  // And they are told, in case it was not them.
  await waitForEmail(account.email, /Your Bindersnap password was changed/);

  // The link worked once.
  await page.goto(link!);
  await expect(
    page.getByRole("heading", { name: "This link no longer works." }),
  ).toBeVisible();
});

test("an address with no account gets the same answer and no email", async ({
  page,
}) => {
  const nobody = `nobody-${randomUUID().slice(0, 12)}@users.bindersnap.local`;

  await page.goto(`${APP_BASE_URL}/-/forgot_password`);
  await page.getByLabel("Email").fill(nobody);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    `If ${nobody} belongs to a Bindersnap account`,
  );

  // Give the outbox time it would have needed to send one.
  await page.waitForTimeout(3_000);
  expect(await countEmails(nobody)).toBe(0);
});

test("a made-up link is turned away before anything is typed", async ({
  page,
}) => {
  await page.goto(`${APP_BASE_URL}/-/reset_password?token=not-a-real-token`);
  await expect(
    page.getByRole("heading", { name: "This link no longer works." }),
  ).toBeVisible();

  const response = await fetch(`${API_BASE_URL}/auth/password/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      token: "not-a-real-token",
      password: "long-enough-1",
    }),
  });
  expect(response.status).toBe(410);
});
