import { describe, expect, test } from "bun:test";
import {
  buildAuthUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  VERIFIER_STORAGE_KEY,
} from "./pkce";

describe("VERIFIER_STORAGE_KEY", () => {
  test("is a non-empty string", () => {
    expect(typeof VERIFIER_STORAGE_KEY).toBe("string");
    expect(VERIFIER_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});

describe("generateCodeVerifier", () => {
  test("returns a string", () => {
    expect(typeof generateCodeVerifier()).toBe("string");
  });

  test("is base64url encoded (no +, /, = chars)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  test("has reasonable length (86 chars for 64 random bytes → base64url)", () => {
    const verifier = generateCodeVerifier();
    // 64 bytes → 88 base64 chars, minus padding → ~86 chars
    expect(verifier.length).toBeGreaterThanOrEqual(80);
    expect(verifier.length).toBeLessThanOrEqual(90);
  });

  test("generates unique verifiers on each call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  test("returns a string", async () => {
    const challenge = await generateCodeChallenge("test-verifier");
    expect(typeof challenge).toBe("string");
  });

  test("is base64url encoded (no +, /, = chars)", async () => {
    const challenge = await generateCodeChallenge("test-verifier");
    expect(challenge).not.toMatch(/[+/=]/);
  });

  test("is deterministic — same verifier always produces same challenge", async () => {
    const verifier = "deterministic-test-verifier-abc123";
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  test("different verifiers produce different challenges", async () => {
    const c1 = await generateCodeChallenge("verifier-one");
    const c2 = await generateCodeChallenge("verifier-two");
    expect(c1).not.toBe(c2);
  });

  test("known SHA-256 base64url value for a fixed input", async () => {
    // echo -n "abc" | openssl dgst -sha256 -binary | base64url → ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=
    // base64url (no padding): ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0
    // → replace + with -, / with _, strip =
    const challenge = await generateCodeChallenge("abc");
    expect(challenge).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("buildAuthUrl", () => {
  const baseParams = {
    giteaUrl: "http://localhost:3000",
    clientId: "my-client-id",
    redirectUri: "http://localhost:5173/auth/callback",
    challenge: "test-challenge-value",
  };

  test("returns a string URL", () => {
    const url = buildAuthUrl(baseParams);
    expect(typeof url).toBe("string");
    expect(() => new URL(url)).not.toThrow();
  });

  test("uses the correct Gitea OAuth2 path", () => {
    const url = new URL(buildAuthUrl(baseParams));
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.origin).toBe("http://localhost:3000");
  });

  test("includes all required OAuth2 params", () => {
    const url = new URL(buildAuthUrl(baseParams));
    expect(url.searchParams.get("client_id")).toBe("my-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("encodes special characters in redirect_uri", () => {
    const url = buildAuthUrl({
      ...baseParams,
      redirectUri: "http://localhost:5173/auth/callback?foo=bar",
    });
    // searchParams getter decodes, so just check it round-trips
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/callback?foo=bar",
    );
  });

  test("works with a production Gitea URL", () => {
    const url = new URL(
      buildAuthUrl({ ...baseParams, giteaUrl: "https://git.example.com" }),
    );
    expect(url.origin).toBe("https://git.example.com");
  });
});
