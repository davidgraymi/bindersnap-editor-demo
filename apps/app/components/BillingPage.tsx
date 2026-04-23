import { useEffect, useRef, useState } from "react";
import { BindersnapLogoMark } from "./BindersnapLogoMark";
import { fetchBillingStatus } from "../api";

interface BillingPageProps {
  subscriptionStatus: "active" | "none" | "loading";
  currentPeriodEnd: number | null;
  onSubscribe: () => Promise<void>;
  onManage: () => Promise<void>;
  onSubscriptionConfirmed: () => void;
}

export function BillingPage({
  subscriptionStatus,
  currentPeriodEnd,
  onSubscribe,
  onManage,
  onSubscriptionConfirmed,
}: BillingPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
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
      return;
    }

    setIsPolling(true);
    let retries = 0;
    const maxRetries = 10;

    const poll = async () => {
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

      retries += 1;
      if (retries < maxRetries && isMounted.current) {
        setTimeout(() => void poll(), 2000);
      } else if (isMounted.current) {
        setIsPolling(false);
      }
    };

    setTimeout(() => void poll(), 2000);
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

  if (subscriptionStatus === "active") {
    const renewalLabel =
      currentPeriodEnd !== null
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
          <p style={{ color: "var(--bs-text-muted)" }}>$100 / month</p>
          <ul
            style={{
              listStyle: "none",
              display: "grid",
              gap: "var(--brand-space-2)",
              color: "var(--bs-text-secondary)",
              fontSize: "var(--brand-text-sm)",
            }}
          >
            <li>Document management</li>
            <li>Version control</li>
            <li>Real-time collaboration</li>
          </ul>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            disabled={isSubmitting || subscriptionStatus === "loading"}
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
        </div>
      </div>
    </section>
  );
}
