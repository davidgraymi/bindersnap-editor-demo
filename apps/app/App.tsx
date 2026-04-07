import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import "./app.css";

import { AppShell } from "./components/AppShell";
import {
  clearToken,
  createAuthenticatedClient,
  storeToken,
} from "../../packages/gitea-client/auth";

const appEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const devDefaultApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:${
  appEnv?.BUN_PUBLIC_API_PORT ?? appEnv?.API_PORT ?? "8787"
}`;
const API_BASE_URL = (
  appEnv?.BUN_PUBLIC_API_BASE_URL ??
  appEnv?.BUN_PUBLIC_API_URL ??
  appEnv?.VITE_API_URL ??
  (isLocalHost ? devDefaultApiBaseUrl : "")
).replace(/\/$/, "");

type AppRoute = "app" | "login" | "callback";
type AuthView = "loading" | "callback" | "login" | "app";
type AuthMode = "signin" | "signup";

interface SessionUser {
  username: string;
  fullName?: string;
}

interface LoginPageProps {
  callbackError: string | null;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onSignup: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
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

function resolveApiUrl(path: string): string {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    if (typeof (payload as { error?: unknown }).error === "string") {
      return (payload as { error: string }).error;
    }

    if (typeof (payload as { message?: unknown }).message === "string") {
      return (payload as { message: string }).message;
    }
  }

  return fallback;
}

/**
 * Authenticates with the app's own API server (the Bun backend at API_BASE_URL).
 * @param path
 * @param username
 * @param password
 */
async function sendAuthRequest(
  path: "/auth/login" | "/auth/signup",
  username: string | null,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const response = await fetch(resolveApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ username, email, password }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload, "Unable to complete authentication right now."),
    );
  }

  return parseSessionUser(payload);
}

function parseSessionUser(payload: unknown): SessionUser | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const root = payload as {
    username?: unknown;
    login?: unknown;
    fullName?: unknown;
    full_name?: unknown;
    user?: {
      username?: unknown;
      login?: unknown;
      fullName?: unknown;
      full_name?: unknown;
    };
  };

  const candidate = root.user ?? root;
  const username =
    typeof candidate.username === "string"
      ? candidate.username
      : typeof candidate.login === "string"
        ? candidate.login
        : "";

  if (username.trim() === "") {
    return null;
  }

  const fullName =
    typeof candidate.fullName === "string"
      ? candidate.fullName
      : typeof candidate.full_name === "string"
        ? candidate.full_name
        : undefined;

  return {
    username: username.trim(),
    fullName: fullName?.trim() || undefined,
  };
}

async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch(resolveApiUrl("/auth/me"), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 404) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      readErrorMessage(payload, "Unable to check your session right now."),
    );
  }

  return parseSessionUser(payload);
}

/**
 * Authenticates directly with Gitea using Basic Auth to mint an API token,
 * then stores it in sessionStorage via `storeToken()`.
 * @param baseUrl
 * @param username
 * @param password
 */
async function createGiteaSessionToken(
  baseUrl: string,
  username: string,
  // email: string,
  password: string,
): Promise<void> {
  const tokenName = `bindersnap-session-${Date.now()}`;
  const tokenScopesRaw =
    appEnv?.BUN_PUBLIC_GITEA_TOKEN_SCOPES ??
    appEnv?.VITE_GITEA_TOKEN_SCOPES ??
    "write:repository,write:issue";
  const tokenScopes = tokenScopesRaw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const credentials = btoa(`${username}:${password}`);
  const response = await fetch(
    `${baseUrl}/api/v1/users/${encodeURIComponent(username)}/tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: tokenName,
        scopes: tokenScopes.length > 0 ? tokenScopes : ["read:repository"],
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, "Unable to connect."));
  }

  const token =
    typeof (payload as { sha1?: unknown }).sha1 === "string"
      ? (payload as { sha1: string }).sha1
      : null;
  if (!token) {
    throw new Error("Gitea did not return a usable token.");
  }

  storeToken(token);
}

async function logoutSession(): Promise<void> {
  await fetch(resolveApiUrl("/auth/logout"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  }).catch(() => undefined);
}

function LoginPage({ callbackError, onLogin, onSignup }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(callbackError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(callbackError);
  }, [callbackError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedUsername = username.trim();
    const normalizedIdentifier = identifier.trim();

    if (mode === "signup") {
      if (
        !normalizedUsername ||
        !normalizedIdentifier ||
        !password ||
        !confirmPassword
      ) {
        setError(
          "Enter a username, email, password, and password confirmation.",
        );
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    } else if (!normalizedIdentifier || !password) {
      setError("Enter your username or email and password.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (mode === "signin") {
        await onLogin(normalizedIdentifier, password);
      } else {
        await onSignup(normalizedUsername, normalizedIdentifier, password);
      }
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message.trim() !== "") {
        setError(submitError.message);
      } else {
        setError(
          `Unable to ${mode === "signin" ? "sign in" : "sign up"} right now.`,
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="app-login-shell">
      <div className="app-login-wrap">
        <div className="app-login-panel bs-card">
          <div className="bs-eyebrow">Secure Access</div>
          <h1>
            {mode === "signin"
              ? "Step into the clean version."
              : "Create your Bindersnap workspace."}
          </h1>

          <form className="app-form" onSubmit={handleSubmit}>
            {mode === "signup" ? (
              <label className="app-field">
                <span className="bs-label">Username</span>
                <input
                  className="bs-input"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Choose a username"
                  autoComplete="username"
                />
              </label>
            ) : null}

            <label className="app-field">
              <span className="bs-label">
                {mode === "signin" ? "Username or Email" : "Email"}
              </span>
              <input
                className="bs-input"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={
                  mode === "signin"
                    ? "Enter your username or email"
                    : "Enter your email"
                }
                autoComplete={mode === "signin" ? "username" : "email"}
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
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
              />
            </label>

            {mode === "signup" ? (
              <label className="app-field">
                <span className="bs-label">Confirm Password</span>
                <input
                  className="bs-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Confirm your password"
                  autoComplete="new-password"
                />
              </label>
            ) : null}

            <button
              className="bs-btn bs-btn-primary app-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? mode === "signin"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "signin"
                  ? "Open workspace"
                  : "Create account"}
            </button>
          </form>

          <div className="app-login-switch">
            <span>
              {mode === "signin"
                ? "Need an account?"
                : "Already have an account?"}
            </span>
            <button
              className="app-login-switch-button"
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(callbackError);
              }}
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
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

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);

    try {
      const nextUser = await fetchSessionUser();
      setUser(nextUser);
      setCallbackError(null);
      return nextUser;
    } catch (sessionError) {
      setUser(null);
      setCallbackError(
        sessionError instanceof Error
          ? sessionError.message
          : "Unable to check your session right now.",
      );
      return null;
    } finally {
      setIsCheckingSession(false);
    }
  }, []);

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

  useEffect(() => {
    if (route !== "callback") {
      return;
    }

    setCallbackError(
      "Single sign-on callback is not enabled in this build. Sign in with your username or email and password.",
    );
    navigateTo("/login", true);
  }, [route]);

  const view: AuthView = useMemo(() => {
    if (route === "callback") {
      return "callback";
    }

    if (isCheckingSession) {
      return "loading";
    }

    return user ? "app" : "login";
  }, [isCheckingSession, route, user]);

  const giteaBaseUrl = appEnv?.VITE_GITEA_BASE_URL ?? "http://localhost:3000";
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
            Handing the sign-in response back to the workspace session service.
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
        onLogin={async (identifier, password) => {
          clearToken();
          const loginIdentifier = identifier.trim();
          const authenticatedUser = await sendAuthRequest(
            "/auth/login",
            loginIdentifier.includes("@") ? null : loginIdentifier,
            loginIdentifier.includes("@") ? loginIdentifier : "",
            password,
          );
          const loginUser = authenticatedUser ?? (await refreshSession());
          if (!loginUser) {
            throw new Error(
              "Sign-in completed, but the session could not be verified.",
            );
          }
          await createGiteaSessionToken(
            giteaBaseUrl,
            loginUser.username,
            password,
          );
          const nextUser = await refreshSession();
          if (!nextUser) {
            throw new Error(
              "Sign-in completed, but the session could not be verified.",
            );
          }
          navigateTo("/app", true);
        }}
        onSignup={async (username, email, password) => {
          clearToken();
          const authenticatedUser = await sendAuthRequest(
            "/auth/signup",
            username,
            email,
            password,
          );
          const signupUser = authenticatedUser ?? (await refreshSession());
          if (!signupUser) {
            throw new Error(
              "Account created, but the session could not be verified.",
            );
          }
          await createGiteaSessionToken(
            giteaBaseUrl,
            signupUser.username,
            password,
          );
          const nextUser = await refreshSession();
          if (!nextUser) {
            throw new Error(
              "Account created, but the session could not be verified.",
            );
          }
          navigateTo("/app", true);
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
              await logoutSession();
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
          await logoutSession();
          clearToken();
          setUser(null);
          setCallbackError(null);
          navigateTo("/login", true);
        }}
      />
    </div>
  );
}
