/**
 * Confirming an email address after signup (issue #665).
 *
 * A new account is signed in, but the API refuses every app route until the
 * link signup emailed is opened. These build their own accounts with a bare
 * `fetch`, not `signUpAndConfirm`, because the unconfirmed state is the point.
 */
import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

import { LEGAL_VERSION } from "../packages/utils/legal";
import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { waitForEmail } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

interface Account {
  username: string;
  email: string;
  password: string;
  session: string;
}

async function signUpUnconfirmed(): Promise<Account> {
  const suffix = randomUUID().slice(0, 12);
  const username = `confirm-${suffix}`;
  const email = `${username}@users.bindersnap.local`;
  const password = `Bindersnap-${suffix}!`;
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Casey",
      lastName: "Moreno",
      username,
      email,
      password,
      acceptedTerms: LEGAL_VERSION,
    }),
  });
  expect(response.status).toBe(200);
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  return { username, email, password, session };
}

async function call(session: string, method: string, path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    ...(method === "POST" ? { body: JSON.stringify({ name: "Acme" }) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
  };
}

function verifyLink(links: string[]): string {
  return links.find((href) => href.includes("/-/verify_email?token="))!;
}

async function verify(token: string) {
  return fetch(`${API_BASE_URL}/auth/email/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ token }),
  });
}

async function signedInContext(
  context: BrowserContext,
  session: string,
): Promise<void> {
  await context.addCookies([
    {
      name: "bindersnap_session",
      value: session,
      url: API_BASE_URL,
    },
  ]);
}

test("a new account can do nothing until it opens the emailed link", async () => {
  const account = await signUpUnconfirmed();

  const me = await call(account.session, "GET", "/auth/me");
  expect(me.body.user).toMatchObject({
    username: account.username,
    emailVerified: false,
    pendingEmail: account.email,
  });

  for (const [method, path] of [
    ["GET", "/api/app/organizations"],
    ["POST", "/api/app/organizations"],
    ["GET", "/api/app/home/changes"],
  ] as const) {
    const refused = await call(account.session, method, path);
    expect(refused.status, `${method} ${path}`).toBe(403);
    expect(refused.body.code).toBe("email_unverified");
  }

  const email = await waitForEmail(account.email, /^Confirm your email/);
  expect(email.html).toContain(account.username);
  const token = new URL(verifyLink(email.links)).searchParams.get("token")!;

  expect((await verify(token)).status).toBe(200);
  // Opened again — a second tab, a mail scanner — it still says confirmed.
  expect((await verify(token)).status).toBe(200);

  expect(
    (await call(account.session, "GET", "/auth/me")).body.user,
  ).toMatchObject({ emailVerified: true });
  expect(
    (await call(account.session, "GET", "/api/app/organizations")).status,
  ).toBe(200);
});

test("a made-up link is turned away, in the API and on the page", async ({
  page,
}) => {
  expect((await verify("not-a-real-token")).status).toBe(404);

  await page.goto(`${APP_BASE_URL}/-/verify_email?token=not-a-real-token`);
  await expect(
    page.getByRole("heading", { name: "This link no longer works." }),
  ).toBeVisible();
  // The token is out of the address bar once read.
  await expect(page).toHaveURL(/\/-\/verify_email$/);
});

test("signed in, every page waits on the link; opened on another device, this one carries on", async ({
  browser,
}) => {
  const account = await signUpUnconfirmed();
  const laptop = await browser.newContext();
  await signedInContext(laptop, account.session);
  const page = await laptop.newPage();

  for (const path of [
    "/",
    `/-/user_settings/profile`,
    "/-/organizations/new",
  ]) {
    await page.goto(`${APP_BASE_URL}${path}`);
    await expect(
      page.getByRole("heading", { name: "Confirm your email." }),
    ).toBeVisible();
  }
  await expect(page.getByText(account.email)).toBeVisible();

  // Asking straight away is too soon: one just went out.
  await page.getByRole("button", { name: "Send a new link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "A link went out a moment ago",
  );

  // Not opened yet: says so.
  await page.getByRole("button", { name: "I have confirmed it" }).click();
  await expect(page.getByRole("alert")).toContainText("Not confirmed yet");

  // Opened on a phone, where nobody is signed in.
  const email = await waitForEmail(account.email, /^Confirm your email/);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(verifyLink(email.links));
  await expect(
    phone.getByRole("heading", { name: "Your email is confirmed." }),
  ).toBeVisible();
  await expect(phone.getByRole("button", { name: "Sign in" })).toBeVisible();

  // Back on the laptop, it carries on.
  await page.getByRole("button", { name: "I have confirmed it" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirm your email." }),
  ).toBeHidden();
  await expect(page.getByLabel("Start a new organization")).toBeVisible();
});

test("a password reset proves the address too", async ({ page }) => {
  const account = await signUpUnconfirmed();

  await page.goto(`${APP_BASE_URL}/-/forgot_password`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  const reset = await waitForEmail(account.email, /^Reset your/);
  await page.goto(reset.links.find((href) => href.includes("reset_password"))!);
  await page.getByLabel("New password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm new password").fill(account.password);
  await page.getByRole("button", { name: "Save and sign in" }).click();

  // Signed in, and straight past the waiting page.
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${account.username}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Confirm your email." }),
  ).toBeHidden();
});
