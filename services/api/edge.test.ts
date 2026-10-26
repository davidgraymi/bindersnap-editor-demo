import { describe, expect, test } from "bun:test";

import { applySecurityHeaders, clientIpFrom, WindowLimiter } from "./edge";

describe("applySecurityHeaders", () => {
  test("sets what Caddy used to, and says nothing about the server", () => {
    const headers = new Headers({ Server: "Bun" });
    applySecurityHeaders(headers);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("same-origin");
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(headers.has("server")).toBe(false);
  });

  test("keeps a policy the response set itself", () => {
    const headers = new Headers({
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    applySecurityHeaders(headers);
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
  });
});

describe("clientIpFrom", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://api.bindersnap.test/auth/login", { headers });

  test("behind Cloudflare, believes only CF-Connecting-IP", () => {
    // Cloudflare appends to a visitor's own X-Forwarded-For, so its first
    // entry is whatever the visitor wrote.
    const req = request({
      "x-forwarded-for": "198.51.100.7, 203.0.113.10",
      "cf-connecting-ip": "203.0.113.10",
    });
    expect(clientIpFrom(req, true)).toBe("203.0.113.10");
  });

  test("behind Cloudflare, never falls back to X-Forwarded-For", () => {
    const req = request({ "x-forwarded-for": "198.51.100.7" });
    expect(clientIpFrom(req, true)).toBe("api.bindersnap.test");
  });

  test("elsewhere, reads the first X-Forwarded-For entry first", () => {
    const req = request({
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
      "cf-connecting-ip": "203.0.113.10",
    });
    expect(clientIpFrom(req, false)).toBe("198.51.100.7");
  });

  test("elsewhere, falls back through CF-Connecting-IP and X-Real-IP", () => {
    expect(
      clientIpFrom(request({ "cf-connecting-ip": "203.0.113.10" }), false),
    ).toBe("203.0.113.10");
    expect(clientIpFrom(request({ "x-real-ip": "192.0.2.4" }), false)).toBe(
      "192.0.2.4",
    );
    expect(clientIpFrom(request({}), false)).toBe("api.bindersnap.test");
  });
});

describe("WindowLimiter", () => {
  test("allows max events a window per key, then refuses until it passes", () => {
    let now = 0;
    const limiter = new WindowLimiter(3, 1000, () => now);
    expect([1, 2, 3].map(() => limiter.limited("a"))).toEqual([
      false,
      false,
      false,
    ]);
    expect(limiter.limited("a")).toBe(true);
    expect(limiter.limited("b")).toBe(false);
    now = 1000;
    expect(limiter.limited("a")).toBe(false);
  });

  test("sweeps expired keys once the map is large", () => {
    let now = 0;
    const limiter = new WindowLimiter(1, 1000, () => now);
    for (let n = 0; n < 10_000; n += 1) limiter.limited(`k${n}`);
    now = 1000;
    limiter.limited("fresh");
    // A swept key starts a new window rather than carrying its old count.
    expect(limiter.limited("k0")).toBe(false);
    expect(
      (limiter as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBe(2);
  });
});
