/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth2.
 * All crypto operations use the Web Crypto API — no external dependencies.
 */

export const VERIFIER_STORAGE_KEY = "bindersnap_pkce_verifier";

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
}

/** Build the Gitea OAuth2 authorization URL with PKCE params. */
export function buildAuthUrl({
  giteaUrl,
  clientId,
  redirectUri,
  challenge,
}: BuildAuthUrlParams): string {
  const url = new URL("/login/oauth/authorize", giteaUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
