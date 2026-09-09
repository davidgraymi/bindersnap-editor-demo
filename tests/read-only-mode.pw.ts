/**
 * Read-only mode for a delinquent organization, against a real stack.
 *
 * ADR 0004 makes one structural promise about the paywall: it gates authoring
 * and mutation, and **never** gates reading or exporting. Holding a customer's
 * approval history hostage is the act the ADR says would poison a compliance
 * reference permanently, so this is the claim most worth pinning with a
 * running Gitea rather than a mock.
 *
 * The unit tests cover the predicate — which billing states count as
 * delinquent, and which deliberately do not. This covers the thing they
 * cannot: that a customer whose subscription has lapsed still sees their
 * binder, and no longer sees the controls that would write to it.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  API_BASE_URL,
  APP_BASE_URL,
  GITEA_ADMIN_PASS,
  GITEA_ADMIN_USER,
} from "./helpers";

// Signup, organization creation, binder creation and two page loads, on a
// stack that may be cold. The suite default is nowhere near enough.
test.describe.configure({ mode: "serial", timeout: 180_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `readonly-${suffix}`,
    email: `readonly-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

function sessionFrom(response: Response): string {
  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  expect(match?.[1], "no session cookie in the response").toBeTruthy();
  return match![1]!;
}

function authHeaders(sessionCookie: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${sessionCookie}`,
    "Content-Type": "application/json",
    // A mutation, so it goes through the state-changing origin check.
    Origin: APP_BASE_URL,
  };
}

async function signUp(credentials: Credentials): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify(credentials),
  });
  expect(
    response.status,
    `signup failed: ${await response.clone().text()}`,
  ).toBe(200);
  return sessionFrom(response);
}

async function signIn(identifier: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ identifier, password }),
  });
  expect(
    response.status,
    `login failed: ${await response.clone().text()}`,
  ).toBe(200);
  return sessionFrom(response);
}

async function createOrganization(
  sessionCookie: string,
  name: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name }),
  });
  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: { name: string } }).organization
    .name;
}

async function createBinder(
  sessionCookie: string,
  org: string,
  name: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name }),
  });
  const body = await response.text();
  expect(response.status, `create binder failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

/**
 * Cut the organization off, as an administrator would for non-payment.
 *
 * `admin_revoke` is the top of `resolveAccess`'s precedence list, so this is
 * the shortest honest route to the state a lapsed Stripe subscription
 * produces — and it does not need Stripe credentials, which the integration
 * environment may not have.
 */
async function revokeAccess(
  adminSession: string,
  username: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/admin/subscriptions/access/${encodeURIComponent(username)}`,
    {
      method: "PUT",
      headers: authHeaders(adminSession),
      body: JSON.stringify({ access: "revoke", reason: "read-only mode test" }),
    },
  );
  const body = await response.text();
  expect(response.status, `revoke failed: ${body}`).toBe(200);
}

async function signInBrowser(page: Page, sessionCookie: string): Promise<void> {
  await page.context().addCookies([
    {
      name: "bindersnap_session",
      value: sessionCookie,
      url: APP_BASE_URL,
    },
  ]);
}

test("a delinquent organization keeps its record and loses its controls", async ({
  page,
}) => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Readonly Health ${randomUUID().slice(0, 6)}`,
  );
  const binder = await createBinder(sessionCookie, org, "Clinical Policies");

  await signInBrowser(page, sessionCookie);

  // Before: a member in good standing is offered the way to write.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await expect(
    page.getByRole("button", { name: "Add a policy" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New policy" })).toBeVisible();
  await expect(page.getByTestId("read-only-banner")).toHaveCount(0);

  const adminSession = await signIn(GITEA_ADMIN_USER, GITEA_ADMIN_PASS);
  await revokeAccess(adminSession, credentials.username);

  // After: the binder is still theirs to read, and the banner says why the
  // controls are gone. The app must not have been replaced by the card form —
  // that was the behaviour this feature removed, and asserting the binder's
  // own heading is what tells the two apart.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await expect(page.getByTestId("read-only-banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: binder })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a policy" })).toHaveCount(
    0,
  );
  // The top nav's create button sits on every page, so leaving it would put
  // the one unusable affordance in front of them everywhere they went. It was
  // missed on the first pass and found by looking at a screenshot.
  await expect(page.getByRole("button", { name: "New policy" })).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(`/${org}/${binder}`);
  // The empty state must not instruct an action whose control is gone.
  await expect(page.getByText("Nothing filed here yet.")).toBeVisible();
  await expect(page.getByText("Add a policy and it joins")).toHaveCount(0);

  // The API half of the same promise, asserted directly rather than through
  // the screen: reads are open, writes are refused, and the refusal is typed
  // so the SPA can tell it from the billing endpoint's own 402.
  const read = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(read.status, "reading a binder must never be gated").toBe(200);

  const write = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name: "Should Be Refused" }),
  });
  expect(write.status, "authoring must be gated").toBe(402);
  const refusal = (await write.json()) as {
    code?: string;
    organization?: string | null;
  };
  expect(refusal.code).toBe("subscription_required");
  expect(refusal.organization).toBe(org);
});
