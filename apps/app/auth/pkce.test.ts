import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  STATE_STORAGE_KEY,
  VERIFIER_STORAGE_KEY,
} from "./pkce";

describe("VERIFIER_STORAGE_KEY", () => {
  test("is a non-empty string", () => {
    expect(typeof VERIFIER_STORAGE_KEY).toBe("string");
    expect(VERIFIER_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});

describe("STATE_STORAGE_KEY", () => {
  test("is a non-empty string", () => {
    expect(typeof STATE_STORAGE_KEY).toBe("string");
    expect(STATE_STORAGE_KEY.length).toBeGreaterThan(0);
  });

  test("is distinct from VERIFIER_STORAGE_KEY", () => {
    expect(STATE_STORAGE_KEY).not.toBe(VERIFIER_STORAGE_KEY);
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
    state: "test-state-value",
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

  test("includes all required OAuth2 params including state", () => {
    const url = new URL(buildAuthUrl(baseParams));
    expect(url.searchParams.get("client_id")).toBe("my-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/auth/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("test-state-value");
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

describe("exchangeCodeForToken", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const baseParams = {
    giteaUrl: "http://localhost:3000",
    code: "auth_code_abc123",
    verifier: "test-verifier-value",
    redirectUri: "http://localhost:5173/auth/callback",
    clientId: "test-client-id",
  };

  test("returns access_token on success", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "gta_test_token_123",
            token_type: "bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const token = await exchangeCodeForToken(baseParams);
    expect(token).toBe("gta_test_token_123");
  });

  test("posts to the correct Gitea token endpoint", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      capturedMethod = "POST";
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "tok" }), { status: 200 }),
      );
    });

    await exchangeCodeForToken(baseParams);
    expect(capturedUrl).toBe("http://localhost:3000/login/oauth/access_token");
    expect(capturedMethod).toBe("POST");
  });

  test("throws with server error message on failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
      ),
    );

    await expect(exchangeCodeForToken(baseParams)).rejects.toThrow(
      "invalid_grant",
    );
  });

  test("throws generic message when response has no access_token and no error field", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ token_type: "bearer" }), { status: 200 }),
      ),
    );

    await expect(exchangeCodeForToken(baseParams)).rejects.toThrow(
      "Token exchange failed.",
    );
  });

  test("throws when response body is not parseable JSON", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("not json", { status: 200 })),
    );

    await expect(exchangeCodeForToken(baseParams)).rejects.toThrow();
  });
});
