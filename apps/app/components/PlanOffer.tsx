import { Check } from "lucide-react";

interface PlanOfferProps {
  /** The organization's name, as people call it. */
  organizationName: string;
  plan: { formatted: string } | null;
  /** Whether this person can buy it. Billing is an owner's (ADR 0004). */
  canManage: boolean;
  submitting: boolean;
  onSubscribe: () => void;
  /** Buttons beside Subscribe — "Not now" in the dialog. */
  secondary?: React.ReactNode;
}

/** What a subscription gets an organization, in the product's own terms. */
const INCLUDED = [
  "Create binders and file documents in them",
  "Propose changes, collect approvals and publish versions",
  "Every version kept, with who approved it and when",
  "Reviewers read, comment and approve at no extra cost",
] as const;

/**
 * The offer: what it costs, what it gets you, and the button.
 *
 * One component for the paywall dialog and the Billing page, so a customer
 * meets the same price and the same promise wherever they meet it. It leads
 * with what stays free, because the fear a lapsed customer has is losing the
 * record, and the answer is no.
 */
export function PlanOffer({
  organizationName,
  plan,
  canManage,
  submitting,
  onSubscribe,
  secondary = null,
}: PlanOfferProps) {
  return (
    <section className="bs-panel plan-offer" aria-label="Bindersnap Pro">
      <div className="plan-offer-head">
        <div>
          <h3 className="plan-offer-name">Bindersnap Pro</h3>
          <p className="plan-offer-for">For everyone in {organizationName}</p>
        </div>
        <p className="plan-offer-price">
          {plan ? plan.formatted : "Price shown at checkout"}
        </p>
      </div>
      <ul className="plan-offer-list">
        {INCLUDED.map((line) => (
          <li key={line}>
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
      <div className="bs-panel-foot">
        <span className="bs-panel-foot-note">
          {canManage
            ? "Reading and exporting stay free, always. Checkout is handled by Stripe."
            : `Only an owner of ${organizationName} can subscribe. Reading and exporting stay free, always.`}
        </span>
        {secondary}
        {canManage ? (
          <button
            className="bs-btn bs-btn-primary bs-btn--sm"
            type="button"
            disabled={submitting}
            onClick={onSubscribe}
          >
            {submitting ? "Redirecting…" : "Subscribe"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
