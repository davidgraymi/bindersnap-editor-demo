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

function buildUniqueSignupCredentials() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    username: `signup-${suffix}`,
    email: `signup-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

async function openSignupForm(page: Page): Promise<void> {
  await page.goto("/signup", { waitUntil: "domcontentloaded" });
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

/**
 * A new account is asked to name its organization, then lands in its
 * workspace — not at a card form.
 *
 * ADR 0004 gives every new organization a 14-day local trial, and #369 is
 * explicit that there is no card during it — representing that in Stripe would
 * create a customer and a subscription for every tire-kicker. So the billing
 * page is somewhere a new user can go, not somewhere they are sent.
 *
 * Naming comes first because signup no longer guesses: an organization owns
 * the binders, and the person who owns it is the one who should say what it is
 * called.
 */
async function signUpThroughOrganizationSetup(
  page: Page,
  username: string,
): Promise<void> {
  // Signup no longer creates an organization behind the person's back, so this
  // is where a new account lands: naming the thing that will own its binders.
  await expect(page).toHaveURL(/\/organizations\/new$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: /organization/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Authoring needs an organization, so create one the way a person would.
  await page.getByLabel("Organization name").fill("Mercy Health");
  await page.getByRole("button", { name: "Create organization" }).click();

  // Provisioning creates the organization, its first binder, three role teams
  // and a protected branch before it answers, so the workspace takes longer to
  // appear than the 5 s default allows.
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${username}"]`),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page).not.toHaveURL(/\/billing$/);
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

  await signUpThroughOrganizationSetup(page, credentials.username);
  await attachScreenshot(
    page,
    testInfo,
    `${screenshotPrefix}-workspace-after-signup`,
  );

  await signOutCurrentUser(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
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
  // Signup is no longer one Gitea call. ADR 0004 has it create the
  // organization, its first binder, that binder's three role teams and the
  // rules on `main` before it answers, and the round trip through sign-out and
  // back in adds waits of its own — `signOutCurrentUser` alone allows 20s.
  // None of that fits the 10s default, which is sized for an assertion rather
  // than for a whole account lifecycle.
  test.describe.configure({ timeout: 90_000 });

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

    await signUpThroughOrganizationSetup(page, firstAccount.username);
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
