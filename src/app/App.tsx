import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { TokenGate } from "./components/TokenGate";
import { buildAuthUrl, generateCodeChallenge, generateCodeVerifier, VERIFIER_STORAGE_KEY } from "./auth/pkce";
import { clearToken, getStoredToken, storeToken, validateToken } from "../services/gitea/auth";

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const GITEA_URL = appEnv?.BUN_PUBLIC_GITEA_URL ?? appEnv?.VITE_GITEA_URL ?? "http://localhost:3000";
const AUTO_LOGIN_FLAG = appEnv?.BUN_PUBLIC_DEV_AUTO_LOGIN ?? appEnv?.VITE_DEV_AUTO_LOGIN;
const AUTO_LOGIN_ENABLED =
  AUTO_LOGIN_FLAG !== undefined ? AUTO_LOGIN_FLAG === "true" || AUTO_LOGIN_FLAG === "1" : appEnv?.NODE_ENV !== "production";
const OAUTH_CLIENT_ID = appEnv?.BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI = appEnv?.BUN_PUBLIC_GITEA_OAUTH_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;

let pendingAutoLoginToken: Promise<string> | null = null;

async function requestAutoLoginToken(): Promise<string> {
  if (!pendingAutoLoginToken) {
    pendingAutoLoginToken = (async () => {
      const response = await fetch("/api/dev/gitea-token", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Auto-login token request failed (${response.status}).`);
      }

      const payload = (await response.json()) as { token?: unknown };
      if (typeof payload.token !== "string" || payload.token.trim() === "") {
        throw new Error("Auto-login response did not include a valid token.");
      }

      return payload.token.trim();
    })();
  }

  try {
    return await pendingAutoLoginToken;
  } finally {
    pendingAutoLoginToken = null;
  }
}

/** Initiate PKCE login: generate verifier, store it, redirect to Gitea. */
async function startPkceLogin(): Promise<void> {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  window.location.href = buildAuthUrl({
    giteaUrl: GITEA_URL,
    clientId: OAUTH_CLIENT_ID,
    redirectUri: OAUTH_REDIRECT_URI,
    challenge,
  });
}

/** Handle the OAuth2 callback: exchange code for token, return it. */
async function handleOAuthCallback(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) throw new Error("No authorization code in callback URL.");

  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  if (!verifier) throw new Error("PKCE verifier missing from session — login flow may have been interrupted.");
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

  const tokenUrl = new URL("/login/oauth/access_token", GITEA_URL);
  const response = await fetch(tokenUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });

  if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);
  const data = (await response.json()) as { access_token?: string; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.access_token) throw new Error("No access_token in Gitea response.");

  return data.access_token;
}

type AuthView = "loading" | "callback" | "login" | "app";

export function App() {
  const path = window.location.pathname;
  const isCallback = path === "/auth/callback";

  const [token, setToken] = useState<string | null>(() => (isCallback ? null : getStoredToken()));
  const [view, setView] = useState<AuthView>(() => {
    if (isCallback) return "callback";
    if (token) return "app";
    if (AUTO_LOGIN_ENABLED) return "loading";
    return "login";
  });
  const [callbackError, setCallbackError] = useState<string | null>(null);

  // Dev auto-login
  useEffect(() => {
    if (view !== "loading" || token) return;
    let cancelled = false;

    void (async () => {
      try {
        const nextToken = await requestAutoLoginToken();
        await validateToken(GITEA_URL, nextToken);
        storeToken(nextToken);
        if (!cancelled) {
          setToken(nextToken);
          setView("app");
        }
      } catch {
        if (!cancelled) {
          setView("login");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, token]);

  // PKCE callback handling
  useEffect(() => {
    if (view !== "callback") return;
    let cancelled = false;

    void (async () => {
      try {
        const nextToken = await handleOAuthCallback();
        await validateToken(GITEA_URL, nextToken);
        storeToken(nextToken);
        if (!cancelled) {
          setToken(nextToken);
          // Replace callback URL with /app to keep history clean
          window.history.replaceState({}, "", "/app");
          setView("app");
        }
      } catch (err) {
        if (!cancelled) {
          setCallbackError(err instanceof Error ? err.message : "Authentication failed.");
          setView("login");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view]);

  if (view === "loading" || view === "callback") {
    return (
      <section className="app-gate">
        <div className="app-gate-panel bs-card">
          <div className="bs-eyebrow">{view === "callback" ? "Authentication" : "Developer Entry"}</div>
          <h1>{view === "callback" ? "Completing sign-in..." : "Signing you in..."}</h1>
          <p className="app-gate-copy">
            {view === "callback"
              ? "Exchanging authorization code for access token."
              : "Creating a short-lived Gitea token for local dev auto-login."}
          </p>
        </div>
      </section>
    );
  }

  if (view === "login") {
    // If an OAuth client ID is configured, show the PKCE login button.
    // Otherwise fall back to the manual token gate (useful for dev without OAuth setup).
    if (OAUTH_CLIENT_ID) {
      return (
        <section className="app-gate">
          <div className="app-gate-panel bs-card">
            <div className="bs-eyebrow">Authentication</div>
            <h1>Welcome to Bindersnap</h1>
            <p className="app-gate-copy">Sign in with your Gitea account to access the workspace.</p>

            {callbackError ? <p className="app-inline-error">{callbackError}</p> : null}

            <button
              className="bs-btn bs-btn-primary app-submit"
              type="button"
              onClick={() => void startPkceLogin()}
            >
              Sign in with Gitea
            </button>
          </div>
        </section>
      );
    }

    return (
      <div className="app-root">
        <TokenGate baseUrl={GITEA_URL} onAuthenticated={(t) => { setToken(t); setView("app"); }} />
      </div>
    );
  }

  // view === "app"
  return (
    <div className="app-root">
      <AppShell
        baseUrl={GITEA_URL}
        token={token!}
        onSignOut={() => {
          clearToken();
          setToken(null);
          setView(AUTO_LOGIN_ENABLED ? "loading" : "login");
        }}
      />
    </div>
  );
}
