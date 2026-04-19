import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import "./app.css";

import { AppShell } from "./components/AppShell";
import { LandingPage } from "./components/LandingPage";
import {
  clearToken,
  fetchSessionUser,
  login,
  logoutSession,
  signup,
  storeToken,
} from "./api";
import {
  asShellRoute,
  getRoute,
  isProtectedAppRoute,
  routeToPath,
  type AppRoute,
} from "./routes";
import { resolveSignupPrefill } from "./authIntent";

type AuthView = "loading" | "callback" | "landing" | "login" | "app";
type AuthMode = "signin" | "signup";

interface SessionUser {
  username: string;
  fullName?: string;
}

interface LoginPageProps {
  mode: AuthMode;
  prefilledEmail?: string;
  callbackError: string | null;
  onLogin: (
    identifier: string,
    password: string,
    rememberMe: boolean,
  ) => Promise<void>;
  onSignup: (
    username: string,
    email: string,
    password: string,
  ) => Promise<void>;
}

function navigateTo(route: AppRoute, replace = false): void {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", routeToPath(route));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function LoginPage({
  mode,
  prefilledEmail = "",
  callbackError,
  onLogin,
  onSignup,
}: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState(
    mode === "signup" ? prefilledEmail : "",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
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
        await onLogin(normalizedIdentifier, password, rememberMe);
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
        <div className="app-login-logo">
          <div className="app-login-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none" width="24" height="24">
              <rect
                x="2"
                y="1"
                width="9"
                height="13"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <rect
                x="6"
                y="4"
                width="9"
                height="13"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </div>
          <span className="app-login-logo-text">Bindersnap</span>
        </div>
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

            {mode === "signin" ? (
              <label className="app-check-row">
                <input
                  className="app-check-input"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Keep me signed in for 30 days</span>
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
                navigateTo({ kind: mode === "signin" ? "signup" : "login" });
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
      } else {
        clearToken();
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

    if (user && (route.kind === "login" || route.kind === "signup")) {
      navigateTo({ kind: "home" }, true);
      return;
    }

    if (!user && isProtectedAppRoute(route)) {
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

    if (route.kind === "home") {
      return user ? "app" : "landing";
    }

    if (isCheckingSession) {
      return "loading";
    }

    return user ? "app" : "login";
  }, [isCheckingSession, route, user]);

  useEffect(() => {
    document.body.setAttribute("data-app-view", view);

    return () => {
      document.body.removeAttribute("data-app-view");
    };
  }, [view]);

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
    const authMode: AuthMode = route.kind === "signup" ? "signup" : "signin";
    const prefilledEmail =
      route.kind === "signup"
        ? resolveSignupPrefill(window.location.search).email
        : "";

    return (
      <LoginPage
        key={`${authMode}:${prefilledEmail}`}
        mode={authMode}
        prefilledEmail={prefilledEmail}
        callbackError={callbackError}
        onLogin={async (identifier, password, rememberMe) => {
          clearToken();
          const authenticatedSession = await login(
            identifier,
            password,
            rememberMe,
          );
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
          navigateTo({ kind: "home" }, true);
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
          navigateTo({ kind: "home" }, true);
        }}
      />
    );
  }

  if (view === "landing") {
    return <LandingPage />;
  }

  return (
    <div className="app-root">
      <AppShell
        user={user}
        route={asShellRoute(route)}
        onNavigate={navigateTo}
        onSignOut={async () => {
          await logoutSession();
          clearToken();
          setUser(null);
          setCallbackError(null);
          navigateTo({ kind: "home" }, true);
        }}
      />
    </div>
  );
}
