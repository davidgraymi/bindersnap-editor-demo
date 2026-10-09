import { useEffect, useRef, useState } from "react";

import { resendVerificationEmail, verifyEmail } from "../api";
import { navigateToHref } from "../appLink";
import { AuthShell } from "./AuthShell";

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * What a signed-in account sees until it confirms its address — on every page,
 * since the API answers the app's routes with `403 email_unverified` until
 * then. The link is usually opened in another tab or on a phone, so coming
 * back to this tab checks again on its own.
 */
export function ConfirmEmailPage({
  email,
  onCheck,
  onSignOut,
}: {
  email: string | null;
  /** Re-read the session. Resolves whether the address is confirmed now. */
  onCheck: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
}) {
  const [notice, setNotice] = useState<{
    tone: "status" | "error";
    text: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const onCheckRef = useRef(onCheck);
  onCheckRef.current = onCheck;

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") {
        void onCheckRef.current().catch(() => undefined);
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  const resend = async () => {
    setIsBusy(true);
    setNotice(null);
    try {
      const alreadyConfirmed = await resendVerificationEmail();
      if (alreadyConfirmed) {
        await onCheck();
        return;
      }
      setNotice({
        tone: "status",
        text: `A new link is on its way${email ? ` to ${email}` : ""}. Earlier links no longer work.`,
      });
    } catch (err) {
      setNotice({
        tone: "error",
        text: messageOf(err, "A new link could not be sent right now."),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const check = async () => {
    setIsBusy(true);
    setNotice(null);
    try {
      if (!(await onCheck())) {
        setNotice({
          tone: "error",
          text: "Not confirmed yet. Open the link in the newest email from Bindersnap.",
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AuthShell title="Confirm your email.">
      <p className="app-gate-copy">
        We sent a link to {email ? <strong>{email}</strong> : "your email"}.
        Open it to finish setting up your account. It works for 24 hours.
      </p>
      <p className="app-gate-copy">
        Nothing after a few minutes? Check spam, or send a new one.
      </p>
      <div className="app-form">
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="button"
          disabled={isBusy}
          onClick={() => void check()}
        >
          I have confirmed it
        </button>
        <button
          className="bs-btn bs-btn-secondary app-submit"
          type="button"
          disabled={isBusy}
          onClick={() => void resend()}
        >
          Send a new link
        </button>
      </div>
      {notice ? (
        <p
          className={
            notice.tone === "error" ? "app-inline-error" : "app-gate-copy"
          }
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="app-login-switch">
        <span>Signed up with the wrong address?</span>
        <button
          className="app-login-switch-button"
          type="button"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </div>
    </AuthShell>
  );
}

type LinkState =
  | { kind: "checking" }
  | { kind: "confirmed" }
  | { kind: "failed"; message: string };

/**
 * `/-/verify_email?token=…`: where the confirmation link lands.
 *
 * Confirms as soon as it opens — the link is only proof the email arrived, so
 * there is nothing to ask first. Works signed in or not, since it is often
 * opened on a phone; `onContinue` takes a signed-in person on into the app.
 */
export function VerifyEmailPage({
  signedIn,
  onContinue,
}: {
  signedIn: boolean;
  onContinue: () => Promise<void>;
}) {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
  );
  const [link, setLink] = useState<LinkState>({ kind: "checking" });

  useEffect(() => {
    // The token is a credential. Out of the address bar, history and any
    // Referer, now that it has been read.
    window.history.replaceState({}, "", "/-/verify_email");
    if (!token) {
      setLink({
        kind: "failed",
        message: "This link is missing its code. Open it from the email again.",
      });
      return;
    }
    let cancelled = false;
    verifyEmail(token)
      .then(() => {
        if (!cancelled) setLink({ kind: "confirmed" });
      })
      .catch((err) => {
        if (!cancelled) {
          setLink({
            kind: "failed",
            message: messageOf(err, "Your email could not be confirmed."),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (link.kind === "checking") {
    return (
      <AuthShell title="Confirm your email.">
        <p className="app-gate-copy" role="status">
          Confirming your email…
        </p>
      </AuthShell>
    );
  }

  if (link.kind === "failed") {
    return (
      <AuthShell title="This link no longer works.">
        <p className="app-gate-copy">{link.message}</p>
        <button
          className="bs-btn bs-btn-primary app-submit"
          type="button"
          onClick={() => navigateToHref(signedIn ? "/" : "/-/login")}
        >
          {signedIn ? "Send a new link" : "Sign in"}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Your email is confirmed.">
      <p className="app-gate-copy" role="status">
        Thanks. Your Bindersnap account is ready.
      </p>
      <button
        className="bs-btn bs-btn-primary app-submit"
        type="button"
        onClick={() =>
          signedIn ? void onContinue() : navigateToHref("/-/login")
        }
      >
        {signedIn ? "Continue" : "Sign in"}
      </button>
    </AuthShell>
  );
}
