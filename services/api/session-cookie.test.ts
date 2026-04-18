import { describe, expect, test } from "bun:test";

import {
  buildSessionLifetime,
  resolveCookieSameSite,
  serializeSessionCookie,
} from "./server";

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

  test("persistent cookies include configured domain, SameSite, and expiry", () => {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const cookie = serializeSessionCookie(
      new Request("https://api.bindersnap.com/auth/login"),
      "session-123",
      {
        expiresAt,
        domain: ".bindersnap.com",
        sameSite: "None",
      },
    );

    expect(cookie).toContain("bindersnap_session=session-123");
    expect(cookie).toContain("Domain=.bindersnap.com");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=");
    expect(cookie).toContain("Expires=");
  });

  test("session cookies omit Max-Age and Expires", () => {
    const cookie = serializeSessionCookie(
      new Request("https://api.bindersnap.com/auth/login"),
      "session-123",
      {
        domain: ".bindersnap.com",
        sameSite: "Lax",
      },
    );

    expect(cookie).toContain("Domain=.bindersnap.com");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Max-Age=");
    expect(cookie).not.toContain("Expires=");
  });

  test("SameSite parsing falls back to Lax for invalid values", () => {
    expect(resolveCookieSameSite("none")).toBe("None");
    expect(resolveCookieSameSite("strict")).toBe("Strict");
    expect(resolveCookieSameSite("not-valid")).toBe("Lax");
  });
});
