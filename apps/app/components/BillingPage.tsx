import { useEffect, useRef, useState } from "react";
import { fetchBillingStatus } from "../api";
import {
  VISIBLE_POLLING_DELAYS_MS,
  BACKGROUND_POLL_INTERVAL_MS,
  BACKGROUND_POLL_WINDOW_MS,
  runBackgroundPoll,
} from "./checkoutPolling";
import { PlanOffer } from "./PlanOffer";
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
  /** Open Stripe's portal on its cancel screen. */
  onCancel: () => Promise<void>;
  /** Whether this person may subscribe, cancel or change the card. */
  canManageBilling: boolean;
  /** Whether a Stripe customer exists, so the portal has a page. */
  hasBillingAccount: boolean;
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
  onCancel,
  canManageBilling,
  hasBillingAccount,
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
  // Polling asks after the organization the checkout was for, which is the
  // one this page is about. A ref, so a name arriving late does not restart it.
  const pollOrganization = useRef(organization);
  pollOrganization.current = organization;
  const fetchThisOrganization = () =>
    fetchBillingStatus(pollOrganization.current);

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
          const billing = await fetchThisOrganization();
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
          fetchThisOrganization,
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
    canManage: canManageBilling,
    hasBillingAccount,
  });
  const loading = subscriptionStatus === "loading";
  // Subscribing is the offer below the panel; the panel keeps the portal.
  const offersPlan =
    summary.actions.includes("subscribe") ||
    (summary.ownersOnly &&
      (summary.standing === "Trial" || summary.standing === "Inactive"));
  const portalActions = summary.actions.filter(
    (action): action is "manage" | "cancel" => action !== "subscribe",
  );
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
            <span className="bs-section-title">Subscription</span>
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
          </ul>
          {summary.ownersOnly && !offersPlan ? (
            <div className="bs-panel-foot">
              <span className="bs-panel-foot-note">
                Only an owner of{" "}
                {organization ? organizationName : "the organization"} can
                subscribe, change the card or cancel.
              </span>
            </div>
          ) : portalActions.length > 0 ? (
            <div className="bs-panel-foot">
              <span className="bs-panel-foot-note">
                Invoices, the card on file and cancelling are handled in
                Stripe&apos;s billing portal.
              </span>
              {portalActions.map((action, index) => {
                const busy = isSubmitting || isRetryingBillingStatus;
                const tone =
                  action === "cancel"
                    ? "bs-btn--quiet"
                    : index === 0
                      ? "bs-btn-primary"
                      : "bs-btn-secondary";
                const [label, work] =
                  action === "manage"
                    ? (["Manage subscription", onManage] as const)
                    : (["Cancel subscription", onCancel] as const);
                const fallback = "Unable to open billing portal.";
                return (
                  <button
                    key={action}
                    className={`bs-btn ${tone} bs-btn--sm`}
                    type="button"
                    disabled={busy}
                    onClick={() => void run(work, fallback)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      )}

      {/* The same offer the paywall makes, so the price and the promise are
          one wherever a customer meets them. */}
      {!loading && !hasBillingStatusError && offersPlan ? (
        <PlanOffer
          organizationName={
            organization ? organizationName : "your organization"
          }
          plan={plan}
          canManage={canManageBilling}
          submitting={isSubmitting}
          onSubscribe={() => void run(onSubscribe, "Unable to start checkout.")}
        />
      ) : null}

      {error ? (
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
