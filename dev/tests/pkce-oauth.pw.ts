/**
 * Integration tests for PKCE OAuth2 app registration and login route.
 *
 * Verifies that the seed script registers a public OAuth2 app in Gitea
 * and that the /login route is reachable (serves the app HTML).
 */

import { expect, test } from "@playwright/test";

import { seedDevStack } from "./seed";

const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";
const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";
const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? "bindersnap-dev";
const APP_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("PKCE OAuth2 app seed and route availability", () => {
  let oauthClientId: string | undefined;

  test.beforeAll(async () => {
    const result = await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: false,
      log: () => undefined,
    });
    oauthClientId = result.oauthClientId;
  });

  test("seed registers a public OAuth2 app and returns a client_id", () => {
    expect(typeof oauthClientId).toBe("string");
    expect(oauthClientId!.length).toBeGreaterThan(0);
  });

  test("seed is idempotent — re-running returns the same client_id", async () => {
    const result = await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: false,
      log: () => undefined,
    });
    expect(result.oauthClientId).toBe(oauthClientId);
  });

  test("/login route returns the app HTML", async ({ request }) => {
    const response = await request.get(`${APP_BASE_URL}/login`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<!doctype html");
  });

  test("/auth/callback route returns the app HTML", async ({ request }) => {
    const response = await request.get(`${APP_BASE_URL}/auth/callback`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<!doctype html");
  });
});
