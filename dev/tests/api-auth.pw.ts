import { expect, test, type APIRequestContext } from "@playwright/test";

import { seedDevStack } from "./seed";

const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";
const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";
const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? "bindersnap-dev";
const APP_ORIGIN =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.APP_PORT ?? "5173"}`;
const API_BASE_URL =
  process.env.PLAYWRIGHT_API_BASE_URL ??
  `http://localhost:${process.env.API_PORT ?? "8787"}`;

function extractSessionCookie(setCookieHeader: string | undefined): string | null {
  if (!setCookieHeader) {
    return null;
  }

  const match = setCookieHeader.match(/bindersnap_session=[^;]+/);
  return match ? match[0] : null;
}

async function loginWithCredentials(
  request: APIRequestContext,
): Promise<{ responseStatus: number; sessionCookie: string | null; responseHeaders: Record<string, string> }> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    headers: {
      Origin: APP_ORIGIN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: {
      username: "alice",
      password: "bindersnap-dev",
    },
  });

  const responseHeaders = response.headers();
  return {
    responseStatus: response.status(),
    sessionCookie: extractSessionCookie(responseHeaders["set-cookie"]),
    responseHeaders,
  };
}

test.describe("API credential auth flow", () => {
  test.beforeAll(async () => {
    await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: false,
      log: () => undefined,
    });
  });

  test("POST /auth/login returns CORS headers and a session cookie", async ({
    request,
  }) => {
    const { responseStatus, sessionCookie, responseHeaders } =
      await loginWithCredentials(request);

    expect(responseStatus).toBe(200);
    expect(responseHeaders["access-control-allow-origin"]).toBe(APP_ORIGIN);
    expect(responseHeaders["access-control-allow-credentials"]).toBe("true");
    expect(sessionCookie).toBeTruthy();
  });

  test("GET /auth/me accepts cookie from credential login", async ({
    request,
  }) => {
    const { sessionCookie } = await loginWithCredentials(request);
    expect(sessionCookie).toBeTruthy();

    const meResponse = await request.get(`${API_BASE_URL}/auth/me`, {
      headers: {
        Origin: APP_ORIGIN,
        Accept: "application/json",
        Cookie: sessionCookie ?? "",
      },
    });

    expect(meResponse.status()).toBe(200);
    expect(meResponse.headers()["access-control-allow-origin"]).toBe(APP_ORIGIN);
    const payload = (await meResponse.json()) as {
      user?: { username?: string };
    };
    expect(payload.user?.username).toBe("alice");
  });
});
