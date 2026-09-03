import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import "./app.css";

import { AnonymousDocumentShell } from "./components/AnonymousDocumentShell";
import { AppShell } from "./components/AppShell";
import { BillingPage } from "./components/BillingPage";
import { OrganizationSetupPage } from "./components/OrganizationSetupPage";
import { BindersnapLogoMark } from "./components/BindersnapLogoMark";
import { LandingPage } from "./components/LandingPage";
import { WorkspaceSkeleton } from "./components/WorkspaceSkeleton";
import {
  type SessionUser,
  createCheckoutSession,
  createOrganization,
  createPortalSession,
  fetchBillingStatus,
  fetchOrganizations,
  fetchSessionUser,
  login,
  logoutSession,
  signup,
} from "./api";
import type { OrganizationSummary } from "../../packages/api-schema/schemas/organizations";
import { usePaymentRequiredHandler } from "./paymentRequired";
import {
  asShellRoute,
  getRoute,
  isLegacyDocumentTabPath,
  isLegacyInboxPath,
  isProtectedAppRoute,
  routeToPath,
  type AppRoute,
} from "./routes";
import { resolveSignupPrefill } from "./authIntent";

type AuthView =
  | "loading"
  | "callback"
  | "landing"
  | "login"
  | "billing"
  | "createOrganization"
  | "app"
  | "publicDoc";
type AuthMode = "signin" | "signup";

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

export function resolveSubscriptionStatus(
  status: string | null,
  hasAccess = false,
): "active" | "none" {
  if (hasAccess) {
    return "active";
  }

  return status === "active" || status === "trialing" ? "active" : "none";
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
        await onLogin(normalizedIdentifier, password, true);
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
            <BindersnapLogoMark width={24} height={24} />
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
  const [subscriptionStatus, setSubscriptionStatus] = useState<
    "active" | "none" | "loading" | null
  >(null);
  const [hasBillingStatusError, setHasBillingStatusError] = useState(false);
  // Where the access comes from. A trial counts as access, but it is not a
  // subscription — so a trialing customer must still be able to open the page
  // where they buy one.
  const [accessSource, setAccessSource] = useState<string | null>(null);
  // Which organizations this session is in. An empty list is an ordinary
  // answer — an account that predates ADR 0004 has none — and it is also what
  // decides whether we may promise a trial.
  // `null` means "not known yet", which is not the same as "none". A failed
  // read must not be mistaken for an account with no organization, or a
  // transient error would tell someone who has one that they are about to
  // create their first — and promise them a trial that is not coming.
  const [organizations, setOrganizations] = useState<
    OrganizationSummary[] | null
  >(null);
  const [suggestedOrganizationName, setSuggestedOrganizationName] = useState<
    string | null
  >(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<number | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelAt, setCancelAt] = useState<number | null>(null);
  const [plan, setPlan] = useState<{
    amount: number;
    currency: string;
    interval: string;
    formatted: string;
  } | null>(null);
  const handlePaymentRequired = useCallback(() => {
    if (!user) {
      return;
    }

    setSubscriptionStatus("none");
    setAccessSource(null);
    setHasBillingStatusError(false);
    setCurrentPeriodEnd(null);
    setCancelAtPeriodEnd(false);
    setCancelAt(null);
    navigateTo({ kind: "billing" }, true);
  }, [user]);

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);

    try {
      const nextSession = await fetchSessionUser();
      const resolvedUser = nextSession?.user ?? null;
      setUser(resolvedUser);
      setCallbackError(null);
      if (resolvedUser) {
        setSubscriptionStatus("loading");
        setHasBillingStatusError(false);
        try {
          setOrganizations(await fetchOrganizations().catch(() => null));
          const billing = await fetchBillingStatus();
          setSubscriptionStatus(
            resolveSubscriptionStatus(billing.status, billing.hasAccess),
          );
          setAccessSource(billing.accessSource ?? null);
          setHasBillingStatusError(false);
          setCurrentPeriodEnd(billing.currentPeriodEnd);
          setCancelAtPeriodEnd(billing.cancelAtPeriodEnd);
          setCancelAt(billing.cancelAt);
          setPlan(billing.plan);
        } catch {
          setSubscriptionStatus("none");
          setAccessSource(null);
          setHasBillingStatusError(true);
          setCurrentPeriodEnd(null);
          setCancelAtPeriodEnd(false);
          setCancelAt(null);
          setPlan(null);
        }
      } else {
        setOrganizations(null);
        setSubscriptionStatus(null);
        setHasBillingStatusError(false);
        setCurrentPeriodEnd(null);
        setCancelAtPeriodEnd(false);
        setCancelAt(null);
        setPlan(null);
      }
      return resolvedUser;
    } catch (sessionError) {
      setUser(null);
      setSubscriptionStatus(null);
      setHasBillingStatusError(false);
      setCurrentPeriodEnd(null);
      setCancelAtPeriodEnd(false);
      setCancelAt(null);
      setPlan(null);
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

  // `/inbox` is gone — Home shows what used to be there. Rewrite the address
  // bar so an old link lands somewhere that still exists and stays bookmarkable.
  useEffect(() => {
    if (isLegacyInboxPath(window.location.pathname)) {
      navigateTo({ kind: "workspace" }, true);
      return;
    }

    // Same for the document's old Team and Settings tabs, now one page.
    if (isLegacyDocumentTabPath(window.location.pathname)) {
      navigateTo(route, true);
    }
  }, [route]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  usePaymentRequiredHandler(handlePaymentRequired);

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

    const isAdminSubscriptionRoute =
      route.kind === "adminSubscriptions" && user?.isAdmin;

    if (user && (route.kind === "login" || route.kind === "signup")) {
      navigateTo({ kind: "home" }, true);
      return;
    }

    if (!user && isProtectedAppRoute(route)) {
      navigateTo({ kind: "login" }, true);
      return;
    }

    if (user && route.kind === "adminSubscriptions" && !user.isAdmin) {
      navigateTo({ kind: "home" }, true);
      return;
    }

    const isCheckoutSuccess =
      window.location.search.includes("checkout=success");

    if (
      user &&
      user.isAdmin &&
      subscriptionStatus === "none" &&
      route.kind === "home"
    ) {
      navigateTo({ kind: "adminSubscriptions" }, true);
      return;
    }

    // Someone with no organization has nothing to pay for yet, so sending them
    // to a card form asks the wrong question. Send them to name an
    // organization instead; the trial that comes with it is what carries them
    // to a billing page later, when there is something to buy.
    if (
      user &&
      accessSource === "no_organization" &&
      route.kind !== "createOrganization" &&
      route.kind !== "billing" &&
      !isAdminSubscriptionRoute
    ) {
      navigateTo({ kind: "createOrganization" }, true);
      return;
    }

    if (
      user &&
      subscriptionStatus === "none" &&
      accessSource !== "no_organization" &&
      route.kind !== "billing" &&
      route.kind !== "createOrganization" &&
      !isAdminSubscriptionRoute
    ) {
      navigateTo({ kind: "billing" }, true);
      return;
    }

    // Bounce back to the workspace only when there is genuinely nothing to do
    // on this page. A customer on a trial has access but no subscription, and
    // sending them home would leave them no way to become a paying one.
    if (
      user &&
      subscriptionStatus === "active" &&
      accessSource === "stripe" &&
      route.kind === "billing" &&
      !isCheckoutSuccess
    ) {
      navigateTo({ kind: "home" }, true);
      return;
    }
  }, [accessSource, isCheckingSession, route, subscriptionStatus, user]);

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

    if (
      user &&
      subscriptionStatus === "none" &&
      !(route.kind === "adminSubscriptions" && user.isAdmin)
    ) {
      return "billing";
    }

    if (route.kind === "home") {
      return user ? "app" : "landing";
    }

    if (isCheckingSession) {
      return "loading";
    }

    if (route.kind === "createOrganization" && user) {
      return "createOrganization";
    }

    if (route.kind === "billing" && user) {
      return "billing";
    }

    if (!user && route.kind === "document") {
      return "publicDoc";
    }

    return user ? "app" : "login";
  }, [isCheckingSession, route, subscriptionStatus, user]);

  useEffect(() => {
    document.body.setAttribute("data-app-view", view);

    return () => {
      document.body.removeAttribute("data-app-view");
    };
  }, [view]);

  if (view === "callback") {
    return <WorkspaceSkeleton label="Completing sign-in" />;
  }

  if (view === "loading") {
    return <WorkspaceSkeleton label="Opening your workspace" />;
  }

  if (view === "createOrganization") {
    return (
      <OrganizationSetupPage
        suggestedName={suggestedOrganizationName}
        // Only their first gets a trial, and this screen must not promise one
        // it cannot deliver.
        isFirstOrganization={organizations?.length === 0}
        reason={accessSource === "no_organization" ? "blocked-write" : null}
        onCreate={async (name) => {
          await createOrganization(name);
          // The organization changes what this session can do, so re-read
          // access rather than guessing at it. If that read fails the
          // organization still exists, and stranding someone on this form —
          // the one screen that cannot help them any further — is the worst
          // answer available; the next navigation reads it again anyway.
          await refreshSession().catch(() => undefined);
          setSuggestedOrganizationName(null);
          navigateTo({ kind: "home" }, true);
        }}
        onSkip={() => navigateTo({ kind: "home" }, true)}
      />
    );
  }

  if (view === "billing") {
    return (
      <BillingPage
        subscriptionStatus={subscriptionStatus ?? "loading"}
        accessSource={accessSource}
        hasBillingStatusError={hasBillingStatusError}
        currentPeriodEnd={currentPeriodEnd}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
        cancelAt={cancelAt}
        plan={plan}
        onSubscribe={async () => {
          const { url } = await createCheckoutSession();
          window.location.href = url;
        }}
        onManage={async () => {
          const { url } = await createPortalSession();
          window.location.href = url;
        }}
        onSubscriptionConfirmed={() => {
          setSubscriptionStatus("active");
          setAccessSource("stripe");
          setHasBillingStatusError(false);
          navigateTo({ kind: "home" }, true);
        }}
        onRetryBillingStatus={async () => {
          await refreshSession();
        }}
        onSignOut={async () => {
          await logoutSession();
          setUser(null);
          setCallbackError(null);
          navigateTo({ kind: "home" }, true);
        }}
      />
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
          const authenticatedSession = await login(
            identifier,
            password,
            rememberMe,
          );
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
          const authenticatedSession = await signup(username, email, password);
          // Carried from the signup form so the create-organization screen
          // arrives filled in rather than asking again.
          setSuggestedOrganizationName(
            authenticatedSession.suggestedOrganizationName ?? null,
          );
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

  if (view === "publicDoc" && route.kind === "document") {
    return <AnonymousDocumentShell route={route} onNavigate={navigateTo} />;
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
          setUser(null);
          setCallbackError(null);
          navigateTo({ kind: "home" }, true);
        }}
      />
    </div>
  );
}
