import { describe, expect, test } from "bun:test";

import { buildSessionLifetime, serializeSessionCookie } from "./server";

describe("API session cookies", () => {
  test("remember-me sessions default to a 30 day persistent cookie and session", () => {
    const now = 1_700_000_000_000;
    const lifetime = buildSessionLifetime(true, now);

    expect(lifetime.sessionExpiresAt).toBe(now + 30 * 24 * 60 * 60 * 1000);
    expect(lifetime.cookieExpiresAt).toBe(now + 30 * 24 * 60 * 60 * 1000);
  });

  test("non-remembered sessions keep a server expiry but omit cookie persistence", () => {
    const now = 1_700_000_000_000;
    const lifetime = buildSessionLifetime(false, now);

    expect(lifetime.sessionExpiresAt).toBe(now + 7 * 24 * 60 * 60 * 1000);
    expect(lifetime.cookieExpiresAt).toBeUndefined();
  });

  test("persistent cookies include configured SameSite and expiry", () => {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = serializeSessionCookie(
      new Request("https://api.bindersnap.com/auth/login"),
      "session-123",
      { expiresAt },
    );

    expect(cookie).toContain("bindersnap_session=session-123");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("Expires=");
    expect(cookie).not.toContain("Domain=");
  });

  test("session cookies omit Max-Age and Expires", () => {
    const cookie = serializeSessionCookie(
      new Request("https://api.bindersnap.com/auth/login"),
      "session-123",
    );

    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Max-Age=");
    expect(cookie).not.toContain("Expires=");
    expect(cookie).not.toContain("Domain=");
  });
});
