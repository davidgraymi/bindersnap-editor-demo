import { type FormEvent, useEffect, useState } from "react";

import "./app.css";

import { AppShell } from "./components/AppShell";
import {
  buildAuthUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  VERIFIER_STORAGE_KEY,
} from "./auth/pkce";
import {
  clearToken,
  getStoredToken,
  storeToken,
  validateToken,
} from "../../packages/gitea-client/auth";

const appEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
const GITEA_URL =
  appEnv?.BUN_PUBLIC_GITEA_URL ??
  appEnv?.VITE_GITEA_URL ??
  "http://localhost:3000";
const OAUTH_CLIENT_ID = appEnv?.BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID ?? "";
const OAUTH_REDIRECT_URI =
  appEnv?.BUN_PUBLIC_GITEA_OAUTH_REDIRECT_URI ??
  `${window.location.origin}/auth/callback`;
const LOGIN_TOKEN_NAME =
  appEnv?.BUN_PUBLIC_GITEA_LOGIN_TOKEN_NAME?.trim() || "bindersnap-session";
const LOGIN_TOKEN_SCOPES = (
  appEnv?.BUN_PUBLIC_GITEA_LOGIN_TOKEN_SCOPES ?? "all"
)
  .split(",")
  .map((scope) => scope.trim())
  .filter((scope) => scope !== "");
const LOGIN_TOKEN_SCOPE_SET =
  LOGIN_TOKEN_SCOPES.length > 0 ? LOGIN_TOKEN_SCOPES : ["all"];

function buildBasicAuthHeader(identity: string, password: string): string {
  return `Basic ${btoa(`${identity}:${password}`)}`;
}

function credentialCandidates(identifier: string): string[] {
  const normalized = identifier.trim();
  const fallbackUsername = normalized.includes("@")
    ? normalized.slice(0, normalized.indexOf("@"))
    : normalized;

  return [
    ...new Set(
      [normalized, fallbackUsername].filter((value) => value.trim() !== ""),
    ),
  ];
}

async function requestPasswordLogin(
  username: string,
  password: string,
): Promise<string> {
  let loginName = "";
  let authHeader = "";

  for (const candidate of credentialCandidates(username)) {
    const nextAuthHeader = buildBasicAuthHeader(candidate, password);

    let profileResponse: Response;
    try {
      profileResponse = await fetch(new URL("/api/v1/user", GITEA_URL), {
        method: "GET",
        headers: {
          Authorization: nextAuthHeader,
          Accept: "application/json",
        },
      });
    } catch {
      throw new Error("Unable to reach the sign-in service right now.");
    }

    if (!profileResponse.ok) {
      continue;
    }

    const profile = (await profileResponse.json().catch(() => null)) as {
      login?: unknown;
    } | null;
    if (typeof profile?.login === "string" && profile.login.trim() !== "") {
      loginName = profile.login.trim();
      authHeader = nextAuthHeader;
      break;
    }
  }

  if (!loginName || !authHeader) {
    throw new Error("Invalid username or password.");
  }

  try {
    await fetch(
      new URL(
        `/api/v1/users/${encodeURIComponent(loginName)}/tokens/${encodeURIComponent(LOGIN_TOKEN_NAME)}`,
        GITEA_URL,
      ),
      {
        method: "DELETE",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      },
    );
  } catch {
    // Ignore cleanup failures and still attempt token creation.
  }

  const createToken = async (name: string) =>
    fetch(
      new URL(
        `/api/v1/users/${encodeURIComponent(loginName)}/tokens`,
        GITEA_URL,
      ),
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          scopes: LOGIN_TOKEN_SCOPE_SET,
        }),
      },
    );

  let tokenResponse: Response;
  try {
    tokenResponse = await createToken(LOGIN_TOKEN_NAME);
    if (tokenResponse.status === 409) {
      tokenResponse = await createToken(`${LOGIN_TOKEN_NAME}-${Date.now()}`);
    }
  } catch {
    throw new Error("Unable to create an access token right now.");
  }

  if (!tokenResponse.ok) {
    throw new Error("Unable to create an access token right now.");
  }

  const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
    sha1?: unknown;
  } | null;
  if (
    typeof tokenPayload?.sha1 !== "string" ||
    tokenPayload.sha1.trim() === ""
  ) {
    throw new Error("Sign-in completed without an access token.");
  }

  return tokenPayload.sha1.trim();
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
  if (!verifier)
    throw new Error(
      "PKCE verifier missing from session — login flow may have been interrupted.",
    );
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

  if (!response.ok)
    throw new Error(`Token exchange failed (${response.status}).`);
  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
  };
  if (data.error) throw new Error(data.error);
  if (!data.access_token) throw new Error("No access token was returned.");

  return data.access_token;
}

type AuthView = "callback" | "login" | "app";
type AppRoute = "app" | "login" | "callback";

function getRoute(pathname: string): AppRoute {
  const normalizedPath =
    pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;

  if (normalizedPath === "/auth/callback") {
    return "callback";
  }

  if (normalizedPath === "/login") {
    return "login";
  }

  return "app";
}

function getView(route: AppRoute, token: string | null): AuthView {
  if (route === "callback") {
    return "callback";
  }

  if (token) {
    return "app";
  }

  return "login";
}

function navigateTo(path: "/app" | "/login", replace = false): void {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

interface LoginPageProps {
  callbackError: string | null;
  canUseOAuth: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onStartOAuth: () => Promise<void>;
}

function LoginPage({
  callbackError,
  canUseOAuth,
  onLogin,
  onStartOAuth,
}: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(callbackError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);

  useEffect(() => {
    setError(callbackError);
  }, [callbackError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextUsername = username.trim();
    if (!nextUsername || !password) {
      setError("Enter your username and password.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onLogin(nextUsername, password);
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message.trim() !== "") {
        setError(submitError.message);
      } else {
        setError("Unable to sign in right now.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOAuth = async () => {
    setIsStartingOAuth(true);
    setError(null);

    try {
      await onStartOAuth();
    } catch (oauthError) {
      if (oauthError instanceof Error && oauthError.message.trim() !== "") {
        setError(oauthError.message);
      } else {
        setError("Unable to start single sign-on.");
      }
      setIsStartingOAuth(false);
    }
  };

  return (
    <section className="app-login-shell">
      <div className="app-login-wrap">
        <div className="app-login-panel bs-card">
          <div className="bs-eyebrow">Secure Access</div>
          <h1>Step into the clean version.</h1>
          <p className="app-gate-copy">
            Sign in to review the live workspace, not another copy of
            <code className="app-inline-code">
              {" "}
              contract_FINAL_v2_JanEdits_APPROVED(1).docx
            </code>
            .
          </p>

          <form className="app-form" onSubmit={handleSubmit}>
            <label className="app-field">
              <span className="bs-label">Username</span>
              <input
                className="bs-input"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="alice"
                autoComplete="username"
                spellCheck={false}
              />
            </label>

            <label className="app-field">
              <span className="bs-label">Password</span>
              <input
                className="bs-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </label>

            <button
              className="bs-btn bs-btn-primary app-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Signing in..." : "Open workspace"}
            </button>
          </form>

          {error ? <p className="app-inline-error">{error}</p> : null}

          {canUseOAuth ? (
            <button
              className="bs-btn bs-btn-secondary app-submit"
              type="button"
              onClick={() => void handleOAuth()}
              disabled={isStartingOAuth}
            >
              {isStartingOAuth
                ? "Redirecting..."
                : "Use single sign-on instead"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    getRoute(window.location.pathname),
  );
  const [token, setToken] = useState<string | null>(() =>
    route === "callback" ? null : getStoredToken(),
  );
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const view = getView(route, token);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (token && route !== "app") {
      navigateTo("/app", true);
    }
  }, [route, token]);

  useEffect(() => {
    if (!token && route === "app" && view === "login") {
      navigateTo("/login", true);
    }
  }, [route, token, view]);

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
          navigateTo("/app", true);
        }
      } catch (err) {
        if (!cancelled) {
          setCallbackError(
            err instanceof Error ? err.message : "Authentication failed.",
          );
          navigateTo("/login", true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view]);

  if (view === "callback") {
    return (
      <section className="app-gate">
        <div className="app-gate-panel bs-card">
          <div className="bs-eyebrow">Authentication</div>
          <h1>Completing sign-in...</h1>
          <p className="app-gate-copy">
            Exchanging authorization code for access token.
          </p>
        </div>
      </section>
    );
  }

  if (view === "login") {
    return (
      <LoginPage
        callbackError={callbackError}
        canUseOAuth={Boolean(OAUTH_CLIENT_ID)}
        onLogin={async (username, password) => {
          const nextToken = await requestPasswordLogin(username, password);
          await validateToken(GITEA_URL, nextToken);
          storeToken(nextToken);
          setCallbackError(null);
          setToken(nextToken);
          navigateTo("/app", true);
        }}
        onStartOAuth={startPkceLogin}
      />
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
          navigateTo("/login", true);
        }}
      />
    </div>
  );
}
