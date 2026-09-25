import { useEffect, useRef, useState } from "react";
import { fetchBillingStatus } from "../api";
import {
  VISIBLE_POLLING_DELAYS_MS,
  BACKGROUND_POLL_INTERVAL_MS,
  BACKGROUND_POLL_WINDOW_MS,
  runBackgroundPoll,
} from "./checkoutPolling";
import { SkeletonPanel } from "./Skeleton";
import { describeBilling } from "./billingAccess";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

interface BillingPageProps {
  subscriptionStatus: "active" | "none" | "loading";
  /**
   * Why this session has access. A trial grants access without a subscription,
   * so `subscriptionStatus` alone cannot tell "already paying" from "trialing"
   * — only `"stripe"` means there is a subscription to show or manage.
   */
  accessSource: string | null;
  hasBillingStatusError: boolean;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  trialEndsAt: number | null;
  /** Whose bill it is — the organization's slug, or null outside one. */
  organization: string | null;
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
}

/**
 * Billing, as a page of the app rather than a screen in front of it.
 *
 * It used to borrow the sign-in card: no sidebar, no top bar, and "Sign out"
 * as the only way off it, so a sidebar link opened a dead end. A paying
 * customer never saw it at all — they were bounced straight back to Home —
 * and everybody else was told to "Start your subscription", whatever access
 * they already had. Now it says where the organization stands and offers the
 * one thing to do about it, inside the shell every other settings page uses.
 */
export function BillingPage({
  subscriptionStatus,
  accessSource,
  hasBillingStatusError,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  cancelAt,
  trialEndsAt,
  organization,
  plan,
  onSubscribe,
  onManage,
  onSubscriptionConfirmed,
  onRetryBillingStatus,
}: BillingPageProps) {
  const organizationName = useOrganizationDisplayName(organization ?? "");
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

  const summary = describeBilling({
    subscriptionStatus,
    accessSource,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    cancelAt,
    trialEndsAt,
  });
  const loading = subscriptionStatus === "loading";
  const checkoutReturned = window.location.search.includes("checkout=success");

  const run = async (action: () => Promise<void>, fallback: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error && actionError.message.trim() !== ""
          ? actionError.message
          : fallback,
      );
    } finally {
      if (isMounted.current) setIsSubmitting(false);
    }
  };

  return (
    <div className="docw-page billing-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">Billing</h1>
          <p className="bs-subtitle">
            {organization
              ? `What ${organizationName} pays for Bindersnap.`
              : "What your organization pays for Bindersnap."}
          </p>
        </div>
      </div>

      {isPolling ? (
        <p className="bs-note" role="status">
          Payment received. Activating your subscription — this takes a moment.
        </p>
      ) : pollingFailed && checkoutReturned ? (
        <p className="bs-note" role="status">
          Your payment was received. Activation can take up to 5 minutes; this
          page is still checking and will update when it is done.
        </p>
      ) : null}

      {hasBillingStatusError ? (
        <div className="bs-note bs-note--danger billing-retry" role="alert">
          <span>
            We couldn&apos;t read your billing status. Retry before you change
            anything.
          </span>
          <button
            className="bs-btn bs-btn-secondary bs-btn--sm"
            type="button"
            disabled={isRetryingBillingStatus}
            onClick={async () => {
              setIsRetryingBillingStatus(true);
              try {
                await onRetryBillingStatus();
              } finally {
                if (isMounted.current) setIsRetryingBillingStatus(false);
              }
            }}
          >
            {isRetryingBillingStatus ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}

      {loading ? (
        <SkeletonPanel label="Loading your billing" rows={2} bar />
      ) : hasBillingStatusError ? null : (
        <section className="bs-panel" aria-label="Plan">
          <div className="bs-panel-bar">
            <span className="bs-section-title">Bindersnap Pro</span>
            <span className={`bs-status bs-status--${summary.tone}`}>
              {summary.standing}
            </span>
          </div>
          <ul className="bs-row-list">
            <li className="bs-row">
              <span className="bs-row-body">
                <span className="bs-row-meta billing-detail">
                  {summary.detail}
                </span>
              </span>
            </li>
            {summary.action === "subscribe" ? (
              <li className="bs-row">
                <span className="bs-row-body">
                  <span className="bs-row-name">Price</span>
                </span>
                <span className="bs-row-right bs-settings-value">
                  {plan ? plan.formatted : "Shown at checkout"}
                </span>
              </li>
            ) : null}
          </ul>
          {summary.action ? (
            <div className="bs-panel-foot">
              <span className="bs-panel-foot-note">
                {summary.action === "manage"
                  ? "Invoices, payment method and cancellation are handled by Stripe."
                  : "Checkout is handled by Stripe. You come back here when it is done."}
              </span>
              {summary.action === "manage" ? (
                <button
                  className="bs-btn bs-btn-primary bs-btn--sm"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    void run(onManage, "Unable to open billing portal.")
                  }
                >
                  {isSubmitting ? "Opening…" : "Manage subscription"}
                </button>
              ) : (
                <button
                  className="bs-btn bs-btn-primary bs-btn--sm"
                  type="button"
                  disabled={isSubmitting || isRetryingBillingStatus}
                  onClick={() =>
                    void run(onSubscribe, "Unable to start checkout.")
                  }
                >
                  {isSubmitting ? "Redirecting…" : "Subscribe"}
                </button>
              )}
            </div>
          ) : null}
        </section>
      )}

      {error ? (
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
