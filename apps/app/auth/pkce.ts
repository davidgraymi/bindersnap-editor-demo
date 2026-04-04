/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth2.
 * All crypto operations use the Web Crypto API — no external dependencies.
 */

export const VERIFIER_STORAGE_KEY = "bindersnap_pkce_verifier";
export const STATE_STORAGE_KEY = "bindersnap_pkce_state";

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Generate a cryptographically random 64-byte code verifier (base64url encoded). */
export function generateCodeVerifier(): string {
  const buffer = new Uint8Array(64);
  crypto.getRandomValues(buffer);
  return base64urlEncode(buffer.buffer);
}

/** Compute SHA-256 of the verifier and return as base64url — the code challenge. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(digest);
}

export interface BuildAuthUrlParams {
  giteaUrl: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  /** Random opaque value bound to this session; validated on callback to prevent CSRF. */
  state: string;
}

/** Build the Gitea OAuth2 authorization URL with PKCE params. */
export function buildAuthUrl({
  giteaUrl,
  clientId,
  redirectUri,
  challenge,
  state,
}: BuildAuthUrlParams): string {
  const url = new URL("/login/oauth/authorize", giteaUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface ExchangeCodeParams {
  giteaUrl: string;
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
}

/**
 * Exchange an authorization code for an access token via the Gitea token endpoint.
 * Sends a form-encoded POST — no client secret required for public clients.
 */
export async function exchangeCodeForToken({
  giteaUrl,
  code,
  verifier,
  redirectUri,
  clientId,
}: ExchangeCodeParams): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const response = await fetch(`${giteaUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  const accessToken =
    typeof (payload as { access_token?: unknown }).access_token === "string"
      ? (payload as { access_token: string }).access_token
      : null;

  if (!accessToken) {
    const errorMsg =
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Token exchange failed.";
    throw new Error(errorMsg);
  }

  return accessToken;
}
