/**
 * Shared helpers for integration test files.
 *
 * All test files in tests/ import from here instead of duplicating setup code.
 * Nothing in this file is a test — it exports only constants, factories, and
 * utilities that multiple *.pw.ts files need.
 */

import { expect, type Page } from "@playwright/test";
import { createGiteaClient } from "../packages/gitea-client/client";
import {
  createAuthenticatedClient,
  storeToken,
  validateToken,
} from "../packages/gitea-client/auth";
import { seedDevStack } from "./seed";

// ---------------------------------------------------------------------------
// Environment constants
// ---------------------------------------------------------------------------

export const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";

export const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";

export const GITEA_ADMIN_PASS =
  process.env.GITEA_ADMIN_PASS ?? "bindersnap-dev";

export const GITEA_BOB_USER = process.env.GITEA_BOB_USER ?? "bob";

export const GITEA_BOB_PASS = process.env.GITEA_BOB_PASS ?? "bindersnap-dev";

/** Raw token string from the environment — may be empty. */
export const ENV_TOKEN = process.env.VITE_GITEA_TOKEN ?? "";

export const APP_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.APP_PORT ?? "5173"}`;

// ---------------------------------------------------------------------------
// Seeded fixture identifiers
//
// These must stay in sync with the values hard-coded inside seed.ts.
// ---------------------------------------------------------------------------

export const OWNER = "alice";
export const REPO = "quarterly-report";
export const SEEDED_BRANCH = "feature/q2-amendments";
export const SEEDED_DOC_PATH = "document.json";

// ---------------------------------------------------------------------------
// In-memory Storage
// ---------------------------------------------------------------------------

/**
 * A fully-spec-compliant in-memory Storage implementation.
 *
 * Used by tests to replace globalThis.sessionStorage so that each test suite
 * has its own isolated key-value store that never touches a real browser
 * context or leaks state across tests.
 */
export function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  } as Storage;
}

/**
 * Install a fresh in-memory Storage as globalThis.sessionStorage.
 *
 * Call once in a test.beforeAll that needs gitea-client auth helpers.
 * The property is configurable so individual tests can replace it again if
 * needed.
 */
export function installMemorySessionStorage(): void {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a usable Gitea token, store it in sessionStorage, and return it.
 *
 * Strategy:
 * 1. If VITE_GITEA_TOKEN is set and passes a live validation check, use it.
 * 2. Otherwise run seedDevStack with createToken:true and use the fresh token.
 *
 * Must be called after installMemorySessionStorage().
 *
 * @param tokenNamePrefix - Prefix for the generated token name when a new
 *   token must be created. Helps distinguish tokens created by different
 *   suites in Gitea's token list.
 */
export async function resolveAndStoreToken(
  tokenNamePrefix = "bindersnap-test",
): Promise<string> {
  const preferred = ENV_TOKEN.trim();
  const usePreferred =
    preferred.length > 0 &&
    (await validateToken(GITEA_URL, preferred)
      .then(() => true)
      .catch(() => false));

  const seedResult = await seedDevStack({
    baseUrl: GITEA_URL,
    adminUser: GITEA_ADMIN_USER,
    adminPass: GITEA_ADMIN_PASS,
    createToken: !usePreferred,
    tokenNamePrefix,
    log: () => {
      // Intentionally silent: avoid leaking setup noise into test output.
    },
  });

  const resolved = usePreferred ? preferred : seedResult.token;
  if (!resolved) {
    throw new Error(
      "Unable to resolve a valid Gitea token for integration tests.",
    );
  }

  storeToken(resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Authenticated client factory
// ---------------------------------------------------------------------------

/**
 * Return an authenticated gitea-client pointed at GITEA_URL, reading the
 * token from globalThis.sessionStorage.
 *
 * Requires resolveAndStoreToken() to have been called first.
 */
export function makeClient() {
  return createAuthenticatedClient(GITEA_URL);
}

/**
 * Create a Gitea client authenticated as bob by requesting a fresh API token
 * for bob using his password credentials. Used in tests that require a second
 * distinct user (e.g., approving alice's own PR — Gitea disallows self-review).
 */
export async function createBobClient() {
  const tokenName = `bindersnap-test-bob-${Date.now()}`;
  const credentials = Buffer.from(
    `${GITEA_BOB_USER}:${GITEA_BOB_PASS}`,
  ).toString("base64");

  const response = await fetch(
    new URL(
      `/api/v1/users/${encodeURIComponent(GITEA_BOB_USER)}/tokens`,
      GITEA_URL,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: tokenName, scopes: ["all"] }),
    },
  );

  if (response.status !== 201) {
    const body = await response.text();
    throw new Error(`Failed to create bob token (${response.status}): ${body}`);
  }

  const json = (await response.json()) as { sha1?: string };
  if (!json.sha1) {
    throw new Error("Bob token creation succeeded but no sha1 was returned.");
  }

  return createGiteaClient(GITEA_URL, json.sha1);
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

/**
 * Poll an async predicate up to `maxAttempts` times with a 1 s delay between
 * each attempt. Throws with a descriptive message if the predicate never
 * returns true within the attempt budget.
 *
 * @param predicate   Async function returning true when the desired state has
 *                    been reached.
 * @param description Human-readable description used in the timeout error.
 * @param maxAttempts Maximum number of polling iterations (default: 30).
 */
export async function pollUntil(
  predicate: () => Promise<boolean>,
  description: string,
  maxAttempts = 30,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for: ${description}`);
}

// ---------------------------------------------------------------------------
// Browser UI helpers (Playwright)
// ---------------------------------------------------------------------------

/**
 * Sign in as Alice (GITEA_ADMIN_USER) via the login page.
 * Skips the login flow if the workspace already shows "Signed in as <alice>".
 *
 * Race-condition-safe: avoids asserting on the login heading (which never
 * renders when a live session redirects the page back to /) and clears
 * sessionStorage before navigating to /login so the app cannot silently
 * redirect an existing session away.
 */
export async function signInAsAlice(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Fast check — already the right user?
  const isAlice = await page
    .locator(".app-user-badge", { hasText: GITEA_ADMIN_USER })
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (isAlice) return;

  // A different session may be active; sign out first if the button is present.
  const hasSignOut = await page
    .getByRole("button", { name: "Sign out" })
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (hasSignOut) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login$/, { timeout: 5_000 });
  } else {
    // Clear session storage so the app stops redirecting on /login.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/login");
    await page.waitForURL(/\/login$/, { timeout: 5_000 });
  }

  await page.getByLabel("Username or Email").fill(GITEA_ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(GITEA_ADMIN_PASS);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.locator(".app-user-badge", { hasText: GITEA_ADMIN_USER }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Sign in as Bob (GITEA_BOB_USER) via the login page.
 * Skips the login flow if the workspace already shows "Signed in as <bob>".
 *
 * Race-condition-safe: same pattern as signInAsAlice — no heading assertion,
 * sessionStorage cleared, waitForURL used throughout.
 */
export async function signInAsBob(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Fast check — already the right user?
  const isBob = await page
    .locator(".app-user-badge", { hasText: GITEA_BOB_USER })
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (isBob) return;

  // A different session may be active; sign out first if the button is present.
  const hasSignOut = await page
    .getByRole("button", { name: "Sign out" })
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (hasSignOut) {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login$/, { timeout: 5_000 });
  } else {
    // Clear session storage so the app stops redirecting on /login.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/login");
    await page.waitForURL(/\/login$/, { timeout: 5_000 });
  }

  await page.getByLabel("Username or Email").fill(GITEA_BOB_USER);
  await page.getByLabel("Password", { exact: true }).fill(GITEA_BOB_PASS);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.locator(".app-user-badge", { hasText: GITEA_BOB_USER }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Navigate from the workspace to a document detail page by clicking the
 * `.vault-doc-card` that contains `docName`, then wait for the back button.
 *
 * Stability fix: waits for DOM content to be loaded before clicking so the
 * card is fully rendered. We intentionally avoid networkidle because the live
 * collaboration socket can keep the page busy indefinitely.
 */
export async function navigateToDocument(
  page: Page,
  docName: string,
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  const card = page.locator(".vault-doc-card", { hasText: docName });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click({ force: true });
  // New UI uses breadcrumb navigation instead of a back button.
  await expect(
    page.locator("nav[aria-label='Breadcrumb'] button", {
      hasText: "Documents",
    }),
  ).toBeVisible({ timeout: 10_000 });
}

export async function waitForNoPendingReviews(
  page: Page,
  cardSearchText: string,
  totalMs = 120_000,
  intervalMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + totalMs;
  let lastAlertText: string | null = null;
  // New UI uses "No pending approvals" heading (was "No pending reviews")
  const noPendingHeading = page.getByRole("heading", {
    name: "No pending approvals",
  });
  // New UI breadcrumb "Documents" button replaces the old "← Back to workspace" button
  const breadcrumbBack = page.locator("nav[aria-label='Breadcrumb'] button", {
    hasText: "Documents",
  });

  while (Date.now() < deadline) {
    // New UI: publish button is "Publish as Official Version"
    const publishButton = page.getByRole("button", {
      name: "Publish as Official Version",
      exact: true,
    });
    const canPublish = await publishButton
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (canPublish) {
      await publishButton.click();
    }

    const publishingButton = page.getByRole("button", { name: "Publishing…" });
    const publishStarted = await publishingButton
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (publishStarted) {
      await publishingButton.waitFor({ state: "hidden", timeout: 60_000 });
    }

    const isVisibleOnCurrentPage = await noPendingHeading
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (isVisibleOnCurrentPage) return;

    const backVisible = await breadcrumbBack
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (backVisible) {
      await breadcrumbBack.click();
      await page.waitForLoadState("domcontentloaded");
    }

    await navigateToDocument(page, cardSearchText);
    await page
      .getByRole("heading", { name: "Loading document details..." })
      .waitFor({ state: "hidden", timeout: 30_000 })
      .catch(() => undefined);

    const isVisible = await noPendingHeading
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (isVisible) return;

    const mergeErrorLocator = page
      .locator(".vault-pr-item")
      .locator('[role="alert"]');
    const hasMergeError = await mergeErrorLocator
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasMergeError) {
      lastAlertText =
        (await mergeErrorLocator.textContent().catch(() => null))?.trim() ??
        "unknown error";
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remaining)),
    );
  }

  if (lastAlertText) {
    throw new Error(
      `Timed out waiting for publish to settle. Last alert text: "${lastAlertText}"`,
    );
  }

  await expect(noPendingHeading).toBeVisible({ timeout: 10_000 });
}

/**
 * Click the "Team" tab (formerly "Collaborators") in the document detail view
 * and wait for the collaborator search input to become visible.
 */
export async function openCollaboratorsTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.locator("#collaborator-search")).toBeVisible({
    timeout: 5_000,
  });
}

export function buildUniqueDocumentMetadata() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    fileName: `ui-document-creation-${suffix}.pdf`,
  };
}

export function expectedPrefilledDocumentName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function openNewDocumentModal(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "New Document" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Document" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Create workspace document" }),
  ).toBeVisible();
}
