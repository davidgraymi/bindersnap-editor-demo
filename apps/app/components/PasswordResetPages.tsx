import { useEffect, useState, type FormEvent } from "react";

import { checkResetLink, requestPasswordReset, resetPassword } from "../api";
import { navigateToHref } from "../appLink";
import { AuthShell } from "./AuthShell";

/** Gitea's own minimum, which the API enforces too. */
const MIN_PASSWORD_LENGTH = 8;

function BackToSignIn() {
  return (
    <div className="app-login-switch">
      <span>Remembered it?</span>
      <button
        className="app-login-switch-button"
        type="button"
        onClick={() => navigateToHref("/-/login")}
      >
        Sign in
      </button>
    </div>
  );
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * `/-/forgot_password`: an address in, a link out.
 *
 * Says the same thing whatever the address — "if it has an account" — because
 * the API will not reveal which addresses do, and the page should not either.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!address.includes("@")) {
      setError("Enter the email address you signed up with.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(address);
      setSentTo(address);
    } catch (err) {
      setError(messageOf(err, "A reset link could not be sent right now."));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your email.">
        <p className="app-gate-copy" role="status">
          If {sentTo} belongs to a Bindersnap account, a link to choose a new
          password is on its way. It works once, for the next hour.
        </p>
        <p className="app-gate-copy">
          Nothing after a few minutes? Check spam, or try the address you signed
          up with.
        </p>
        <BackToSignIn />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password.">
      <p className="app-gate-copy">
        Enter the email you signed up with and we will send you a link to choose
        a new password.
      </p>
      <form className="app-form" onSubmit={handleSubmit}>
        <label className="app-field">
          <span className="bs-label">Email</span>
          <input
            className="bs-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            autoComplete="email"
            spellCheck={false}
            autoFocus
          />
        </label>
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
      <BackToSignIn />
      {error ? <p className="app-inline-error">{error}</p> : null}
    </AuthShell>
  );
}

type LinkState =
  | { kind: "checking" }
  | { kind: "valid"; username: string | null }
  | { kind: "invalid" };

/**
 * `/-/reset_password?token=…`: where the emailed link lands.
 *
 * Checks the link before asking for anything, so an expired one says so up
 * front rather than after a new password has been typed twice. A good reset
 * signs the person in — `onSignedIn` takes it from there.
 */
export function ResetPasswordPage({
  onSignedIn,
}: {
  onSignedIn: () => Promise<void>;
}) {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
  );
  const [link, setLink] = useState<LinkState>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // The token is a credential. Out of the address bar, history and any
    // Referer, now that it has been read.
    window.history.replaceState({}, "", "/-/reset_password");
    if (!token) {
      setLink({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    checkResetLink(token)
      .then((status) => {
        if (cancelled) return;
        setLink(
          status.valid
            ? { kind: "valid", username: status.username ?? null }
            : { kind: "invalid" },
        );
      })
      .catch(() => {
        // Let the reset itself be the judge; it says so if the link is bad.
        if (!cancelled) setLink({ kind: "valid", username: null });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await resetPassword(token, password);
      await onSignedIn();
    } catch (err) {
      setError(messageOf(err, "Your password could not be changed."));
      setIsSubmitting(false);
    }
  };

  if (link.kind === "checking") {
    return (
      <AuthShell title="Reset your password.">
        <p className="app-gate-copy" role="status">
          Checking your link…
        </p>
      </AuthShell>
    );
  }

  if (link.kind === "invalid") {
    return (
      <AuthShell title="This link no longer works.">
        <p className="app-gate-copy">
          Reset links work once, for an hour, and asking for a new one retires
          the old. Ask for another and use the newest email.
        </p>
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="button"
          onClick={() => navigateToHref("/-/forgot_password")}
        >
          Send a new link
        </button>
        <BackToSignIn />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password.">
      <p className="app-gate-copy">
        {link.username ? `For the account ${link.username}. ` : ""}
        Every other device will be signed out.
      </p>
      <form className="app-form" onSubmit={handleSubmit}>
        <label className="app-field">
          <span className="bs-label">New password</span>
          <input
            className="bs-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            autoFocus
          />
        </label>
        <label className="app-field">
          <span className="bs-label">Confirm new password</span>
          <input
            className="bs-input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Type it again"
            autoComplete="new-password"
          />
        </label>
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Save and sign in"}
        </button>
      </form>
      {error ? <p className="app-inline-error">{error}</p> : null}
    </AuthShell>
  );
}
