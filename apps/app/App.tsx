import { useCallback, useEffect, useMemo, useState } from "react";

import "./app.css";

import { AppShell } from "./components/AppShell";
import {
  clearToken,
  createAuthenticatedClient,
  getStoredToken,
  storeToken,
  validateToken,
} from "../../packages/gitea-client/auth";
import {
  buildAuthUrl,
  exchangeCodeForToken,
  generateCodeChallenge,
  generateCodeVerifier,
  STATE_STORAGE_KEY,
  VERIFIER_STORAGE_KEY,
} from "./auth/pkce";

const appEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

type AppRoute = "app" | "login" | "callback";
type AuthView = "loading" | "callback" | "login" | "app";

interface SessionUser {
  username: string;
  fullName?: string;
}

interface LoginPageProps {
  callbackError: string | null;
  onSignIn: () => Promise<void>;
  giteaUrl: string;
}

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

function navigateTo(path: "/app" | "/login", replace = false): void {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function LoginPage({ callbackError, onSignIn, giteaUrl }: LoginPageProps) {
  const [error, setError] = useState<string | null>(callbackError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(callbackError);
  }, [callbackError]);

  return (
    <section className="app-login-shell">
      <div className="app-login-wrap">
        <div className="app-login-panel bs-card">
          <div className="bs-eyebrow">Secure Access</div>
          <h1>Step into the clean version.</h1>
          <p className="app-gate-copy">
            Sign in to pick up the live workspace without reopening another
            approval chain by hand.
          </p>

          <button
            className="bs-btn bs-btn-primary app-submit"
            type="button"
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              setError(null);
              try {
                await onSignIn();
              } catch {
                setError("Unable to start sign-in. Please try again.");
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? "Redirecting..." : "Sign in"}
          </button>

          <div className="app-login-switch">
            <span>Need an account?</span>
            <a
              className="app-login-switch-button"
              href={`${giteaUrl}/user/sign_up`}
              target="_blank"
              rel="noreferrer"
            >
              Register on Gitea
            </a>
          </div>

          {error ? <p className="app-inline-error">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    getRoute(window.location.pathname),
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(
    () => route !== "callback",
  );
  const [callbackError, setCallbackError] = useState<string | null>(null);

  const giteaBaseUrl =
    appEnv?.BUN_PUBLIC_GITEA_BASE_URL ??
    appEnv?.VITE_GITEA_BASE_URL ??
    "http://localhost:3000";
  const oauthClientId = appEnv?.BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID ?? "";

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);
    try {
      const token = getStoredToken();
      if (!token) {
        setUser(null);
        return null;
      }
      const giteaUser = await validateToken(giteaBaseUrl, token);
      const nextUser: SessionUser = {
        username: giteaUser.login,
        fullName: giteaUser.full_name || undefined,
      };
      setUser(nextUser);
      setCallbackError(null);
      return nextUser;
    } catch {
      clearToken();
      setUser(null);
      return null;
    } finally {
      setIsCheckingSession(false);
    }
  }, [giteaBaseUrl]);

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
    if (route === "callback") {
      setIsCheckingSession(false);
      return;
    }

    void refreshSession();
  }, [refreshSession, route]);

  useEffect(() => {
    if (route === "callback" || isCheckingSession) {
      return;
    }

    if (user && route !== "app") {
      navigateTo("/app", true);
      return;
    }

    if (!user && route === "app") {
      navigateTo("/login", true);
    }
  }, [isCheckingSession, route, user]);

  // Handle the OAuth2 PKCE callback: validate state, exchange code for token.
  useEffect(() => {
    if (route !== "callback") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const storedState = sessionStorage.getItem(STATE_STORAGE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);

    // Clear PKCE material immediately — single use regardless of outcome.
    sessionStorage.removeItem(STATE_STORAGE_KEY);
    sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

    if (!code || !state || !storedState || state !== storedState || !verifier) {
      setCallbackError("Authentication failed. Please sign in again.");
      navigateTo("/login", true);
      return;
    }

    const redirectUri = `${window.location.origin}/auth/callback`;

    exchangeCodeForToken({
      giteaUrl: giteaBaseUrl,
      code,
      verifier,
      redirectUri,
      clientId: oauthClientId,
    })
      .then((token) => {
        storeToken(token);
        return validateToken(giteaBaseUrl, token);
      })
      .then((giteaUser) => {
        setUser({
          username: giteaUser.login,
          fullName: giteaUser.full_name || undefined,
        });
        // Replace the callback URL (which contains the auth code) with /app.
        window.history.replaceState({}, "", "/app");
        window.dispatchEvent(new PopStateEvent("popstate"));
      })
      .catch(() => {
        clearToken();
        setCallbackError("Sign-in failed. Please try again.");
        navigateTo("/login", true);
      });
  }, [route, giteaBaseUrl, oauthClientId]);

  const view: AuthView = useMemo(() => {
    if (route === "callback") {
      return "callback";
    }

    if (isCheckingSession) {
      return "loading";
    }

    return user ? "app" : "login";
  }, [isCheckingSession, route, user]);

  let giteaClient = null;
  try {
    giteaClient = createAuthenticatedClient(giteaBaseUrl);
  } catch {
    giteaClient = null;
  }

  if (view === "callback") {
    return (
      <section className="app-gate">
        <div className="app-gate-panel bs-card">
          <div className="bs-eyebrow">Authentication</div>
          <h1>Completing sign-in...</h1>
          <p className="app-gate-copy">
            Exchanging your authorization code for a session token.
          </p>
        </div>
      </section>
    );
  }

  if (view === "loading") {
    return (
      <section className="app-gate">
        <div className="app-gate-panel bs-card">
          <div className="bs-eyebrow">Workspace</div>
          <h1>Checking your session...</h1>
          <p className="app-gate-copy">
            Making sure your workspace is ready before we open the app.
          </p>
        </div>
      </section>
    );
  }

  if (view === "login") {
    return (
      <LoginPage
        callbackError={callbackError}
        giteaUrl={giteaBaseUrl}
        onSignIn={async () => {
          const verifier = generateCodeVerifier();
          const challenge = await generateCodeChallenge(verifier);
          const state = generateCodeVerifier(); // random value for CSRF protection
          sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
          sessionStorage.setItem(STATE_STORAGE_KEY, state);
          const redirectUri = `${window.location.origin}/auth/callback`;
          window.location.href = buildAuthUrl({
            giteaUrl: giteaBaseUrl,
            clientId: oauthClientId,
            redirectUri,
            challenge,
            state,
          });
        }}
      />
    );
  }

  if (!giteaClient) {
    return (
      <section className="app-gate">
        <div className="app-gate-panel bs-card">
          <div className="bs-eyebrow">Workspace</div>
          <h1>Unable to open the document vault</h1>
          <p className="app-gate-copy">
            Workspace token bootstrap failed. Retry, or sign out and sign in
            again to mint a fresh session token.
          </p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Retry
          </button>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={async () => {
              clearToken();
              setUser(null);
              setCallbackError(null);
              navigateTo("/login", true);
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="app-root">
      <AppShell
        user={user}
        giteaClient={giteaClient}
        onSignOut={async () => {
          clearToken();
          setUser(null);
          setCallbackError(null);
          navigateTo("/login", true);
        }}
      />
    </div>
  );
}
