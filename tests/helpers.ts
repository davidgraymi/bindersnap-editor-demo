/**
 * Shared helpers for integration test files.
 *
 * All test files in tests/ import from here instead of duplicating setup code.
 * Nothing in this file is a test — it exports only constants, factories, and
 * utilities that multiple *.pw.ts files need.
 */

import { randomUUID } from "crypto";
import { expect, type Page } from "@playwright/test";
import { createGiteaClient } from "../services/api/gitea-client/client";
import {
  createAuthenticatedClient,
  storeToken,
  validateToken,
} from "../services/api/gitea-client/auth";
import { seedDevStack } from "./seed";

// ---------------------------------------------------------------------------
// Environment constants
// ---------------------------------------------------------------------------

export const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";

export const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";

export const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? "dev";

export const GITEA_BOB_USER = process.env.GITEA_BOB_USER ?? "bob";

export const GITEA_BOB_PASS = process.env.GITEA_BOB_PASS ?? GITEA_ADMIN_PASS;

/** Raw token string from the environment — may be empty. */
export const ENV_TOKEN = process.env.VITE_GITEA_TOKEN ?? "";

export const APP_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.APP_PORT ?? "5173"}`;

export const API_BASE_URL =
  process.env.BUN_PUBLIC_API_BASE_URL ??
  `http://localhost:${process.env.API_PROXY_PORT ?? "8788"}`;

// ---------------------------------------------------------------------------
// Seeded fixture identifiers
//
// These must stay in sync with the values hard-coded inside seed.ts.
// ---------------------------------------------------------------------------

export const OWNER = "alice";
export const REPO = "quarterly-report";
export const SEEDED_BRANCH =
  "upload/quarterly-report/20260210/091500Z-alice-4b1c9de2";
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
  const tokenName = `bindersnap-test-bob-${randomUUID()}`;
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

async function clearBrowserAuthState(page: Page): Promise<void> {
  await page.evaluate(async (apiBaseUrl) => {
    await fetch(`${apiBaseUrl}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }).catch(() => undefined);

    sessionStorage.clear();
  }, API_BASE_URL);

  await page.context().clearCookies();

  await expect
    .poll(
      async () =>
        page.evaluate(async (apiBaseUrl) => {
          const response = await fetch(`${apiBaseUrl}/auth/me`, {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json",
            },
          }).catch(() => null);

          return response?.status ?? 0;
        }, API_BASE_URL),
      {
        timeout: 10_000,
        message: "expected the workspace session to be fully cleared",
      },
    )
    .toBe(401);
}

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
    .locator(`.app-topnav-avatar[aria-label="User: ${GITEA_ADMIN_USER}"]`)
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (isAlice) return;

  // A different session may be active; sign out first if the avatar is present.
  const hasSignOut = await page
    .locator(".app-topnav-avatar")
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (hasSignOut) {
    await signOutCurrentUser(page);
  } else {
    await clearBrowserAuthState(page);
  }

  await page.goto("/login");
  await page.waitForURL(/\/login$/, { timeout: 5_000 });
  await expect(page.getByLabel("Username or Email")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Username or Email").fill(GITEA_ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(GITEA_ADMIN_PASS);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${GITEA_ADMIN_USER}"]`),
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
    .locator(`.app-topnav-avatar[aria-label="User: ${GITEA_BOB_USER}"]`)
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (isBob) return;

  // A different session may be active; sign out first if the avatar is present.
  const hasSignOut = await page
    .locator(".app-topnav-avatar")
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (hasSignOut) {
    await signOutCurrentUser(page);
  } else {
    await clearBrowserAuthState(page);
  }

  await page.goto("/login");
  await page.waitForURL(/\/login$/, { timeout: 5_000 });
  await expect(page.getByLabel("Username or Email")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel("Username or Email").fill(GITEA_BOB_USER);
  await page.getByLabel("Password", { exact: true }).fill(GITEA_BOB_PASS);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.locator(`.app-topnav-avatar[aria-label="User: ${GITEA_BOB_USER}"]`),
  ).toBeVisible({ timeout: 60_000 });
}

export async function signOutCurrentUser(page: Page): Promise<void> {
  // Sign out is inside a dropdown — open the avatar menu first.
  const avatar = page.locator(".app-topnav-avatar");
  await expect(avatar).toBeVisible({ timeout: 5_000 });
  await avatar.click({ force: true });
  // The sign-out item has role="menuitem" in the profile dropdown
  const button = page.locator(
    ".app-profile-menu-item--danger, [role='menuitem']",
    { hasText: "Sign out" },
  );
  await expect(button).toBeVisible({ timeout: 5_000 });
  await button.click({ force: true });
  await page.waitForURL(/\/$/, { timeout: 5_000 });
  await expect(
    page.getByRole("heading", { name: /Your approval process/i }),
  ).toBeVisible({ timeout: 10_000 });
  await clearBrowserAuthState(page);
}

/**
 * Navigate from any app page to a document detail page.
 *
 * Navigates to the Documents list page first, then clicks the row whose
 * text matches `docName`. Waits for `.docw-page` to confirm arrival.
 *
 * Stability fix: waits for DOM content to be loaded before clicking so the
 * list is fully rendered. We intentionally avoid networkidle because the live
 * collaboration socket can keep the page busy indefinitely.
 */
export async function navigateToDocument(
  page: Page,
  docName: string,
): Promise<void> {
  // Navigate to Documents page with a search query for the specific document
  await page.goto(`/documents?q=${encodeURIComponent(docName)}`);
  await page.waitForLoadState("domcontentloaded");

  // DocumentsPage uses .docs-list-item
  const card = page
    .locator(".docs-list-item")
    .filter({ hasText: docName })
    .first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click({ force: true });
  // Confirm we reached the document detail page
  await expect(page.locator(".docw-page")).toBeVisible({ timeout: 10_000 });
}

/** The tabs across the top of the document workspace. */
export type DocumentWorkspaceTab =
  "Document" | "Changes" | "History" | "Team" | "Settings";

/**
 * Switch to one of the document workspace tabs.
 *
 * The Changes and History tabs carry a count in their accessible name
 * ("Changes 2"), so the match is anchored on the label rather than exact.
 */
export async function openDocumentTab(
  page: Page,
  tab: DocumentWorkspaceTab,
): Promise<void> {
  const control = page.getByRole("tab", { name: new RegExp(`^${tab}`) });
  await expect(control).toBeVisible({ timeout: 15_000 });
  await control.click();
}

/**
 * Open one change's own page.
 *
 * The Changes tab is an index of what is waiting on a decision; Approve,
 * Request Changes and Publish live on each change's own page, so getting to
 * them means opening a row. Gitea returns pull requests newest first, so
 * `"last"` is the oldest open change.
 */
export async function openDocumentChange(
  page: Page,
  which: "first" | "last" = "first",
): Promise<void> {
  await openDocumentTab(page, "Changes");
  const rows = page.locator(".change-row-btn");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await (which === "last" ? rows.last() : rows.first()).click();
  await expect(page.locator(".change-detail")).toBeVisible({ timeout: 15_000 });
}

/** Open the first change if there is one. Returns false when the list is empty. */
async function openFirstChangeIfAny(page: Page): Promise<boolean> {
  const row = page.locator(".change-row-btn").first();
  const hasRow = await row.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!hasRow) return false;
  await row.click();
  return await page
    .locator(".change-detail")
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

/** Assert how many changes the Changes tab lists. */
export async function expectChangeRowCount(
  page: Page,
  count: number,
  timeout = 30_000,
): Promise<void> {
  await expect(page.locator(".change-row")).toHaveCount(count, { timeout });
}

/** Assert the header reports version `version` as the official record. */
export async function expectPublishedVersion(
  page: Page,
  version: number,
  timeout = 30_000,
): Promise<void> {
  await expect(page.locator(".doc-version-pill")).toHaveText(`v${version}`, {
    timeout,
  });
}

/** Assert how many changes are waiting on a decision, per the Changes tab. */
export async function expectOpenChangeCount(
  page: Page,
  count: number,
  timeout = 30_000,
): Promise<void> {
  const tab = page.getByRole("tab", { name: /^Changes/ });
  if (count === 0) {
    await expect(tab.locator(".doc-tab-count")).toHaveCount(0, { timeout });
    return;
  }
  await expect(tab.locator(".doc-tab-count")).toHaveText(String(count), {
    timeout,
  });
}

export async function waitForNoPendingReviews(
  page: Page,
  cardSearchText: string,
  totalMs = 120_000,
  intervalMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + totalMs;
  let lastAlertText: string | null = null;
  // The Changes tab shows this once nothing is waiting on a decision.
  const noPendingHeading = page.getByRole("heading", {
    name: "No pending approvals",
  });
  // New UI "Documents" link in topnav replaces the old breadcrumb back button
  const breadcrumbBack = page.locator(".app-topnav-link", {
    hasText: "Documents",
  });

  while (Date.now() < deadline) {
    // Reviewing happens on the Changes tab, so make sure we are on it.
    await openDocumentTab(page, "Changes").catch(() => undefined);
    // …and the publish button lives on the change's own page, not the index.
    await openFirstChangeIfAny(page);

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

    const publishingButton = page.getByRole("button", {
      name: "Publishing\u2026",
    });
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
    await openDocumentTab(page, "Changes").catch(() => undefined);

    const isVisible = await noPendingHeading
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (isVisible) return;

    const mergeErrorLocator = page
      .locator(".change-detail")
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
  await page.getByRole("tab", { name: "Access & approvals" }).click();
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
  const button = page.locator("#topnav-new-doc-btn");
  await expect(button).toBeVisible();
  await button.click();
  await expect(
    page.getByRole("heading", { name: "Create workspace document" }),
  ).toBeVisible();
}

export async function openTopnavNewDocumentModal(page: Page): Promise<void> {
  const button = page.locator("#topnav-new-doc-btn");
  await expect(button).toBeVisible();
  await button.click();
  await expect(
    page.getByRole("heading", { name: "Create workspace document" }),
  ).toBeVisible();
}
