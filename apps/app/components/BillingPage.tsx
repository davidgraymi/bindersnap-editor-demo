import { useEffect, useRef, useState } from "react";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { fetchBillingStatus } from "../api";
import {
  VISIBLE_POLLING_DELAYS_MS,
  BACKGROUND_POLL_INTERVAL_MS,
  BACKGROUND_POLL_WINDOW_MS,
  runBackgroundPoll,
} from "./checkoutPolling";

interface BillingPageProps {
  subscriptionStatus: "active" | "none" | "loading";
  hasBillingStatusError: boolean;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  plan: {
    amount: number;
    currency: string;
    interval: string;
    formatted: string;
  } | null;
  onSubscribe: () => Promise<void>;
  onManage: () => Promise<void>;
  onSubscriptionConfirmed: () => void;
  onRetryBillingStatus: () => Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function BillingPage({
  subscriptionStatus,
  hasBillingStatusError,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  cancelAt,
  plan,
  onSubscribe,
  onManage,
  onSubscriptionConfirmed,
  onRetryBillingStatus,
  onSignOut,
}: BillingPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingFailed, setPollingFailed] = useState(false);
  const [isRetryingBillingStatus, setIsRetryingBillingStatus] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const isCheckoutSuccess =
      window.location.search.includes("checkout=success");
    if (!isCheckoutSuccess) {
      setPollingFailed(false);
      return;
    }

    setIsPolling(true);

    const runVisiblePolling = async () => {
      for (let i = 0; i < VISIBLE_POLLING_DELAYS_MS.length; i++) {
        if (!isMounted.current) {
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, VISIBLE_POLLING_DELAYS_MS[i]),
        );

        if (!isMounted.current) {
          return;
        }

        try {
          const billing = await fetchBillingStatus();
          if (billing.status === "active" || billing.status === "trialing") {
            if (isMounted.current) {
              setIsPolling(false);
              onSubscriptionConfirmed();
            }
            return;
          }
        } catch {
          // continue polling
        }
      }

      if (isMounted.current) {
        setIsPolling(false);
        setPollingFailed(true);

        void runBackgroundPoll(
          fetchBillingStatus,
          () => {
            if (isMounted.current) {
              onSubscriptionConfirmed();
            }
          },
          BACKGROUND_POLL_INTERVAL_MS,
          BACKGROUND_POLL_WINDOW_MS,
        );
      }
    };

    void runVisiblePolling();
  }, [onSubscriptionConfirmed]);

  if (isPolling) {
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
            <div className="bs-eyebrow">Bindersnap Pro</div>
            <h1>Payment received — activating your workspace…</h1>
            <p
              style={{
                color: "var(--bs-text-muted)",
                fontSize: "var(--brand-text-sm)",
              }}
            >
              Verifying your subscription, this will only take a moment.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (pollingFailed && window.location.search.includes("checkout=success")) {
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
            <div className="bs-eyebrow">Bindersnap Pro</div>
            <h1>Activation is taking longer than expected</h1>
            <p style={{ color: "var(--bs-text-muted)" }}>
              Your payment was received. Activation can occasionally take up to
              5 minutes — we&apos;re still checking in the background and will
              redirect you automatically when your workspace is ready.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (subscriptionStatus === "active") {
    const renewalLabel = cancelAtPeriodEnd
      ? cancelAt !== null
        ? `Cancels on ${new Date(cancelAt * 1000).toLocaleDateString()}`
        : "Cancels at end of billing period"
      : currentPeriodEnd !== null
        ? `Renews on ${new Date(currentPeriodEnd * 1000).toLocaleDateString()}`
        : "Active";

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
            <div className="bs-eyebrow">Your subscription</div>
            <h1>Bindersnap Pro</h1>
            <p style={{ color: "var(--bs-text-muted)" }}>{renewalLabel}</p>
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              disabled={isSubmitting}
              onClick={async () => {
                setIsSubmitting(true);
                setError(null);
                try {
                  await onManage();
                } catch (manageError) {
                  if (
                    manageError instanceof Error &&
                    manageError.message.trim() !== ""
                  ) {
                    setError(manageError.message);
                  } else {
                    setError("Unable to open billing portal.");
                  }
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {isSubmitting ? "Opening portal…" : "Manage subscription"}
            </button>
            {error ? <p className="app-inline-error">{error}</p> : null}
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--bs-text-muted)",
                fontSize: "var(--brand-text-sm)",
                fontFamily: "var(--brand-font-sans)",
                textAlign: "left",
              }}
              onClick={() => window.history.back()}
            >
              &larr; Return to workspace
            </button>
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--bs-text-muted)",
                fontSize: "var(--brand-text-sm)",
                fontFamily: "var(--brand-font-sans)",
                textAlign: "left",
              }}
              onClick={() => void onSignOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </section>
    );
  }

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
          <div className="bs-eyebrow">Bindersnap Pro</div>
          <h1>Start your subscription</h1>
          {hasBillingStatusError ? (
            <div
              role="status"
              style={{
                display: "grid",
                gap: "var(--brand-space-3)",
                marginBottom: "var(--brand-space-4)",
                padding: "var(--brand-space-4)",
                borderRadius: "var(--brand-radius-lg)",
                border: "1px solid var(--bs-rule)",
                background: "var(--bs-surface-2)",
                color: "var(--bs-text-secondary)",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--brand-text-sm)",
                }}
              >
                We couldn&apos;t verify your billing status. Please retry before
                you continue.
              </p>
              <div>
                <button
                  className="bs-btn bs-btn-secondary"
                  type="button"
                  disabled={isRetryingBillingStatus}
                  onClick={async () => {
                    setIsRetryingBillingStatus(true);
                    try {
                      await onRetryBillingStatus();
                    } finally {
                      if (isMounted.current) {
                        setIsRetryingBillingStatus(false);
                      }
                    }
                  }}
                >
                  {isRetryingBillingStatus
                    ? "Retrying…"
                    : "Retry billing check"}
                </button>
              </div>
            </div>
          ) : null}
          <p style={{ color: "var(--bs-text-muted)" }}>
            {plan?.formatted ?? "Loading…"}
          </p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            disabled={
              isSubmitting ||
              isRetryingBillingStatus ||
              subscriptionStatus === "loading"
            }
            onClick={async () => {
              setIsSubmitting(true);
              setError(null);
              try {
                await onSubscribe();
              } catch (subscribeError) {
                if (
                  subscribeError instanceof Error &&
                  subscribeError.message.trim() !== ""
                ) {
                  setError(subscribeError.message);
                } else {
                  setError("Unable to start checkout.");
                }
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? "Redirecting…" : "Subscribe now"}
          </button>
          {error ? <p className="app-inline-error">{error}</p> : null}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--bs-text-muted)",
              fontSize: "var(--brand-text-sm)",
              fontFamily: "var(--brand-font-sans)",
              textAlign: "left",
            }}
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
