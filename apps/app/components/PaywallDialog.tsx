import { useEffect, useRef, useState } from "react";

import { useOrganizationDisplayName } from "../useOrganizationDisplayName";
import { PlanOffer } from "./PlanOffer";

interface PaywallDialogProps {
  /** Whose bill it is: the organization's slug, or null if unknown. */
  organization: string | null;
  /** Why the organization cannot write — decides the heading. */
  standing: "trial-ended" | "lapsed" | "none";
  plan: { formatted: string } | null;
  canManage: boolean;
  onSubscribe: () => Promise<void>;
  onClose: () => void;
}

/**
 * The paywall: where every write lands while an organization cannot write.
 *
 * A dialog over the page rather than a trip to Billing, so saying "not now"
 * leaves the person exactly where they were, reading what they were reading.
 */
export function PaywallDialog({
  organization,
  standing,
  plan,
  canManage,
  onSubscribe,
  onClose,
}: PaywallDialogProps) {
  const displayName = useOrganizationDisplayName(organization ?? "");
  const organizationName = displayName || "your organization";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const whose = displayName ? `${displayName}'s` : "Your";
  const heading =
    standing === "trial-ended"
      ? `${whose} free trial has ended`
      : standing === "lapsed"
        ? `${whose} subscription has lapsed`
        : "Subscribe to keep writing";

  return (
    <div
      className="upload-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="upload-modal paywall"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
      >
        <div>
          <h2 id="paywall-title">{heading}</h2>
          <p className="paywall-lede">
            Nothing has been taken away: every binder, version and approval is
            still here to read and export. A subscription is what lets{" "}
            {organizationName} add, change and publish again.
          </p>
        </div>
        <PlanOffer
          organizationName={organizationName}
          plan={plan}
          canManage={canManage}
          submitting={submitting}
          onSubscribe={async () => {
            setSubmitting(true);
            setError(null);
            try {
              await onSubscribe();
            } catch (subscribeError) {
              setError(
                subscribeError instanceof Error &&
                  subscribeError.message.trim() !== ""
                  ? subscribeError.message
                  : "Unable to start checkout.",
              );
              setSubmitting(false);
            }
          }}
          secondary={
            <button
              ref={closeRef}
              className="bs-btn bs-btn--quiet bs-btn--sm"
              type="button"
              onClick={onClose}
            >
              Not now
            </button>
          }
        />
        {error ? (
          <p className="bs-note bs-note--danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
