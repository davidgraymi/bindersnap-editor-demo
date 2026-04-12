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
  fetchSessionUser,
  login,
  logoutSession,
  signup,
  storeToken,
} from "./api";

export type AppRoute =
  | { kind: "login" }
  | { kind: "callback" }
  | { kind: "workspace" }
  | {
      kind: "document";
      owner: string;
      repo: string;
      tab: "overview" | "collaborators";
    };
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
    return { kind: "callback" };
  }

  if (normalizedPath === "/login") {
    return { kind: "login" };
  }

  const collaboratorsMatch = normalizedPath.match(
    /^\/docs\/([^/]+)\/([^/]+)\/collaborators$/,
  );
  if (collaboratorsMatch) {
    return {
      kind: "document",
      owner: collaboratorsMatch[1]!,
      repo: collaboratorsMatch[2]!,
      tab: "collaborators",
    };
  }

  const docMatch = normalizedPath.match(/^\/docs\/([^/]+)\/([^/]+)$/);
  if (docMatch) {
    return {
      kind: "document",
      owner: docMatch[1]!,
      repo: docMatch[2]!,
      tab: "overview",
    };
  }

  return { kind: "workspace" };
}

function navigateTo(route: AppRoute, replace = false): void {
  let path: string;

  switch (route.kind) {
    case "login":
      path = "/login";
      break;
    case "callback":
      path = "/auth/callback";
      break;
    case "document":
      path =
        route.tab === "collaborators"
          ? `/docs/${route.owner}/${route.repo}/collaborators`
          : `/docs/${route.owner}/${route.repo}`;
      break;
    case "workspace":
    default:
      path = "/";
      break;
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
    () => route.kind !== "callback",
  );
  const [callbackError, setCallbackError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);

    try {
      const nextSession = await fetchSessionUser();
      if (nextSession?.token) {
        storeToken(nextSession.token);
      }
      setUser(nextSession?.user ?? null);
      setCallbackError(null);
      return nextSession?.user ?? null;
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
    if (route.kind === "callback") {
      setIsCheckingSession(false);
      return;
    }

    void refreshSession();
    // Session state is independent from in-app pushState navigation.
  }, [refreshSession]);

  useEffect(() => {
    if (route.kind === "callback" || isCheckingSession) {
      return;
    }

    if (user && route.kind !== "workspace" && route.kind !== "document") {
      navigateTo({ kind: "workspace" }, true);
      return;
    }

    if (!user && (route.kind === "workspace" || route.kind === "document")) {
      navigateTo({ kind: "login" }, true);
    }
  }, [isCheckingSession, route, user]);

  useEffect(() => {
    if (route.kind !== "callback") {
      return;
    }

    setCallbackError(
      "Single sign-on callback is not enabled in this build. Sign in with your username or email and password.",
    );
    navigateTo({ kind: "login" }, true);
  }, [route]);

  const view: AuthView = useMemo(() => {
    if (route.kind === "callback") {
      return "callback";
    }

    if (isCheckingSession) {
      return "loading";
    }

    return user ? "app" : "login";
  }, [isCheckingSession, route, user]);

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
          const authenticatedSession = await login(identifier, password);
          if (authenticatedSession.token) {
            storeToken(authenticatedSession.token);
          }
          const loginUser =
            authenticatedSession.user ?? (await refreshSession());
          if (!loginUser) {
            throw new Error(
              "Sign-in completed, but the session could not be verified.",
            );
          }
          const nextUser = await refreshSession();
          if (!nextUser) {
            throw new Error(
              "Sign-in completed, but the session could not be verified.",
            );
          }
          navigateTo({ kind: "workspace" }, true);
        }}
        onSignup={async (username, email, password) => {
          clearToken();
          const authenticatedSession = await signup(username, email, password);
          if (authenticatedSession.token) {
            storeToken(authenticatedSession.token);
          }
          const signupUser =
            authenticatedSession.user ?? (await refreshSession());
          if (!signupUser) {
            throw new Error(
              "Account created, but the session could not be verified.",
            );
          }
          const nextUser = await refreshSession();
          if (!nextUser) {
            throw new Error(
              "Account created, but the session could not be verified.",
            );
          }
          navigateTo({ kind: "workspace" }, true);
        }}
      />
    );
  }

  return (
    <div className="app-root">
      <AppShell
        user={user}
        route={route}
        onNavigate={navigateTo}
        onSignOut={async () => {
          await logoutSession();
          clearToken();
          setUser(null);
          setCallbackError(null);
          navigateTo({ kind: "login" }, true);
        }}
      />
    </div>
  );
}
