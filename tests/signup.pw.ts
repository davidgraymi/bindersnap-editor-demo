/**
 * Integration coverage for the frontend signup flow.
 *
 * Exercises the real app login page, validates client-side password
 * confirmation, verifies the browser sends username/email/password to the
 * local auth API, and confirms backend validation errors are surfaced in the
 * UI.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";

function buildUniqueSignupCredentials() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    username: `signup-${suffix}`,
    email: `signup-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

async function openSignupForm(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Create your Bindersnap workspace.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Confirm Password")).toBeVisible();
}

async function fillSignupForm(
  page: Page,
  credentials: {
    username: string;
    email: string;
    password: string;
  },
  confirmPassword = credentials.password,
): Promise<void> {
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page
    .getByLabel("Confirm Password", { exact: true })
    .fill(confirmPassword);
}

async function submitSignupForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Create account" }).click();
}

async function fillLoginForm(
  page: Page,
  credentials: {
    email: string;
    password: string;
  },
): Promise<void> {
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
}

async function submitLoginForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open workspace" }).click();
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe("signup flow", () => {
  test("creates an account, signs out, and logs back in with email and password", async ({
    page,
  }, testInfo) => {
    const credentials = buildUniqueSignupCredentials();

    await openSignupForm(page);
    await fillSignupForm(page, credentials);
    await attachScreenshot(page, testInfo, "signup-form");

    const signupRequestPromise = page.waitForRequest(
      (request) =>
        request.url().endsWith("/auth/signup") && request.method() === "POST",
    );

    await submitSignupForm(page);

    const signupRequest = await signupRequestPromise;
    expect(signupRequest.postDataJSON()).toMatchObject({
      username: credentials.username,
      email: credentials.email,
      password: credentials.password,
    });

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText(`Signed in as ${credentials.username}`),
    ).toBeVisible();
    await attachScreenshot(page, testInfo, "workspace-after-signup");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Step into the clean version." }),
    ).toBeVisible();
    await fillLoginForm(page, credentials);
    await attachScreenshot(page, testInfo, "login-after-signout");

    const loginRequestPromise = page.waitForRequest(
      (request) =>
        request.url().endsWith("/auth/login") && request.method() === "POST",
    );

    await submitLoginForm(page);

    const loginRequest = await loginRequestPromise;
    expect(loginRequest.postDataJSON()).toMatchObject({
      email: credentials.email,
      password: credentials.password,
    });

    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByText(`Signed in as ${credentials.username}`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await attachScreenshot(page, testInfo, "workspace-after-login");
  });

  test("blocks signup in the browser when passwords do not match", async ({
    page,
  }) => {
    const credentials = buildUniqueSignupCredentials();
    let signupRequestCount = 0;

    page.on("request", (request) => {
      if (
        request.url().endsWith("/auth/signup") &&
        request.method() === "POST"
      ) {
        signupRequestCount += 1;
      }
    });

    await openSignupForm(page);
    await fillSignupForm(page, credentials, `${credentials.password}-mismatch`);
    await submitSignupForm(page);

    await expect(page.getByText("Passwords do not match.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(signupRequestCount).toBe(0);
  });

  test("shows the signup API error when Gitea rejects the submitted email", async ({
    page,
  }) => {
    const firstAccount = buildUniqueSignupCredentials();
    const duplicateEmailAccount = buildUniqueSignupCredentials();
    duplicateEmailAccount.email = firstAccount.email;

    await openSignupForm(page);
    await fillSignupForm(page, firstAccount);
    await submitSignupForm(page);

    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await openSignupForm(page);

    const signupResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/auth/signup") &&
        response.request().method() === "POST",
    );

    await fillSignupForm(page, duplicateEmailAccount);
    await submitSignupForm(page);

    const signupResponse = await signupResponsePromise;
    expect(signupResponse.ok()).toBe(false);

    const payload = (await signupResponse.json()) as { error?: unknown };
    expect(typeof payload.error).toBe("string");

    const errorMessage = payload.error as string;
    expect(errorMessage.trim()).not.toBe("");
    expect(errorMessage.toLowerCase()).toMatch(/email|e-mail/);
    await expect(page.getByText(errorMessage)).toBeVisible();
  });
});
