/**
 * The getting-started guide follows what actually exists, so it picks up
 * where a customer left off — and a step done without it counts.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<string> {
  const suffix = randomUUID().slice(0, 12);
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: `guide-${suffix}`,
      email: `guide-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
}

async function post(session: string, path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  return JSON.parse(text);
}

test("the guide picks up where a new customer left off, and stays hidden once hidden", async ({
  page,
}) => {
  const session = await signUp();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);

  await page.goto(`${APP_BASE_URL}/`);
  await expect(page.locator("section.guide")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("link", { name: /Create your organization/ }),
  ).toBeVisible();

  // Done somewhere else — here through the API — and the guide still knows.
  const { organization } = await post(session, "/api/app/organizations", {
    name: `Guide ${randomUUID().slice(0, 6)}`,
  });
  await post(session, `/api/app/orgs/${organization.name}/binders`, {
    name: "Policy manual",
  });

  await page.reload();
  await expect(page.locator(".guide-step--current")).toContainText(
    "Bring in your documents",
    {
      timeout: 30_000,
    },
  );
  // Organization and binder, and "Decide who approves": a new binder needs
  // no approvals, so nobody is stuck waiting for a colleague to sign off.
  await expect(page.locator(".guide-step--done")).toHaveCount(3);

  // "Add documents" lands in the binder with the dialog already open.
  await page.getByRole("link", { name: /Add documents/ }).click();
  await expect(
    page.getByRole("heading", { name: "Add a document" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  // On other pages it is one line, and hiding it hides it everywhere.
  await expect(
    page.getByRole("region", { name: "Getting started" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide the guide" }).click();
  await page.goto(`${APP_BASE_URL}/`);
  await expect(page.locator("h1.bs-title")).toContainText("Good");
  await expect(page.locator("section.guide")).toHaveCount(0);

  // And it can be brought back from the account menu.
  await page.locator(".app-topnav-avatar").click();
  await page.getByRole("menuitem", { name: "Getting-started guide" }).click();
  await expect(page.locator("section.guide")).toBeVisible({ timeout: 30_000 });
});

test("a finished customer sees no guide", async ({ page }) => {
  await page.goto(`${APP_BASE_URL}/login`);
  await page.getByLabel("Username or Email").fill("alice");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.GITEA_ADMIN_PASS ?? "dev");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.locator(".app-topnav-avatar")).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(3_000);
  await expect(page.locator("section.guide")).toHaveCount(0);
});
