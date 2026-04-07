/**
 * Shared helpers for integration test files.
 *
 * All test files in tests/ import from here instead of duplicating setup code.
 * Nothing in this file is a test — it exports only constants, factories, and
 * utilities that multiple *.pw.ts files need.
 */

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
