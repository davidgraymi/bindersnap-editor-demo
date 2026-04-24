/**
 * Integration coverage for the frontend signup flow.
 *
 * Exercises the real app login page, validates client-side password
 * confirmation, verifies the browser sends username/email/password to the
 * local auth API, and confirms backend validation errors are surfaced in the
 * UI.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { signOutCurrentUser } from "./helpers";

const API_BASE_URL =
  process.env.BUN_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function buildUniqueSignupCredentials() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    username: `signup-${suffix}`,
    email: `signup-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

async function openSignupForm(page: Page): Promise<void> {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/signup$/);
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
    identifier: string;
    password: string;
  },
): Promise<void> {
  await page.getByLabel("Username or Email").fill(credentials.identifier);
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

async function expectBillingPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/billing$/);
  await expect(
    page.getByRole("heading", { name: "Start your subscription" }),
  ).toBeVisible();
}

async function grantDevSubscriptionAndOpenWorkspace(
  page: Page,
  username: string,
): Promise<void> {
  await page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/api/dev/grant-subscription`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      const payload = await response
        .json()
        .catch(() => ({ error: response.status }));
      throw new Error(
        `Grant subscription failed: ${(payload as { error?: unknown }).error ?? response.status}`,
      );
    }
  }, API_BASE_URL);

  await page.goto("/");
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${username}"]`),
  ).toBeVisible();
}

async function signUpAndReturnToLogin(
  page: Page,
  testInfo: TestInfo,
  credentials: {
    username: string;
    email: string;
    password: string;
  },
  screenshotPrefix: string,
): Promise<void> {
  await openSignupForm(page);
  await fillSignupForm(page, credentials);
  await attachScreenshot(page, testInfo, `${screenshotPrefix}-signup-form`);

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

  await expectBillingPage(page);
  await attachScreenshot(
    page,
    testInfo,
    `${screenshotPrefix}-billing-after-signup`,
  );

  await grantDevSubscriptionAndOpenWorkspace(page, credentials.username);
  await signOutCurrentUser(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Step into the clean version." }),
  ).toBeVisible();
}

async function logInWithIdentifier(
  page: Page,
  testInfo: TestInfo,
  credentials: {
    identifier: string;
    password: string;
  },
  expectedPayload: Record<string, string>,
  screenshotPrefix: string,
  expectedUsername: string,
): Promise<void> {
  await fillLoginForm(page, credentials);
  await attachScreenshot(page, testInfo, `${screenshotPrefix}-login-form`);

  const loginRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/auth/login") && request.method() === "POST",
  );

  await submitLoginForm(page);

  const loginRequest = await loginRequestPromise;
  expect(loginRequest.postDataJSON()).toMatchObject(expectedPayload);

  // The user already has an active subscription from the prior dev grant in
  // signUpAndReturnToLogin, so they land directly in the workspace on re-login.
  await attachScreenshot(
    page,
    testInfo,
    `${screenshotPrefix}-workspace-after-login`,
  );

  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${expectedUsername}"]`),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("signup flow", () => {
  test("landing signup carries the typed email into the signup form", async ({
    page,
  }) => {
    const email = `landing-${Date.now()}@users.bindersnap.local`;

    await page.goto("/");
    await page.locator("#hero-email").fill(email);
    await page.locator("#hero-form button").click();

    await expect(page).toHaveURL(/\/signup\?email=/);
    expect(new URL(page.url()).searchParams.get("email")).toBe(email);
    await expect(
      page.getByRole("heading", {
        name: "Create your Bindersnap workspace.",
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });

  test("creates an account, signs out, and logs back in with a username", async ({
    page,
  }, testInfo) => {
    const credentials = buildUniqueSignupCredentials();

    await signUpAndReturnToLogin(page, testInfo, credentials, "username-auth");
    await logInWithIdentifier(
      page,
      testInfo,
      {
        identifier: credentials.username,
        password: credentials.password,
      },
      {
        username: credentials.username,
        password: credentials.password,
        rememberMe: true,
      },
      "username-auth",
      credentials.username,
    );
  });

  test("creates an account, signs out, and logs back in with an email", async ({
    page,
  }, testInfo) => {
    const credentials = buildUniqueSignupCredentials();

    await signUpAndReturnToLogin(page, testInfo, credentials, "email-auth");
    await logInWithIdentifier(
      page,
      testInfo,
      {
        identifier: credentials.email,
        password: credentials.password,
      },
      {
        email: credentials.email,
        password: credentials.password,
        rememberMe: true,
      },
      "email-auth",
      credentials.username,
    );
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
    await expect(page).toHaveURL(/\/signup$/);
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

    await expectBillingPage(page);
    await grantDevSubscriptionAndOpenWorkspace(page, firstAccount.username);
    await signOutCurrentUser(page);
    await page.goto("/login");
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
