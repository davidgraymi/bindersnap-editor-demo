/**
 * Integration tests for PKCE OAuth2 app registration and SPA route availability.
 *
 * Verifies that seedDevStack registers a public OAuth2 application in Gitea and
 * that the app routes consumed by the PKCE login flow serve the SPA HTML shell.
 */

import { expect, test } from "@playwright/test";

import {
  APP_BASE_URL,
  GITEA_ADMIN_PASS,
  GITEA_ADMIN_USER,
  GITEA_URL,
} from "./helpers";
import { seedDevStack } from "./seed";

test.describe("PKCE OAuth2 app registration", () => {
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

  test("seed registers a public OAuth2 application and returns a non-empty client_id", () => {
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
});

test.describe("PKCE SPA route availability", () => {
  test("/login route serves the app HTML shell", async ({ request }) => {
    const response = await request.get(`${APP_BASE_URL}/login`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<!doctype html");
  });

  test("/signup route serves the app HTML shell", async ({ request }) => {
    const response = await request.get(`${APP_BASE_URL}/signup`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<!doctype html");
  });

  test("/auth/callback route serves the app HTML shell", async ({
    request,
  }) => {
    const response = await request.get(`${APP_BASE_URL}/auth/callback`);
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("<!doctype html");
  });
});
