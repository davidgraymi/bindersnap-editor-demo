import { Check } from "lucide-react";

/** The plan as the billing status reports it. */
export interface OfferedPlan {
  /** Per seat, in whole currency units. */
  amount: number;
  currency: string;
  interval: string;
  formatted: string;
  /** The organization's paid seats today, or null if unknown. */
  seats?: number | null;
}

interface PlanOfferProps {
  /** The organization's name, as people call it. */
  organizationName: string;
  plan: OfferedPlan | null;
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
  "Reviewers and staff who only read are free, however many",
  "Add or remove a writer any time; the next invoice follows",
] as const;

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/**
 * The price, said the way the pricing page says it: per writer, and then what
 * that comes to for this organization, so nobody multiplies in their head.
 * An organization is billed for at least one seat.
 */
export function describePlanPrice(plan: OfferedPlan): {
  unit: string;
  total: string | null;
} {
  const per = plan.interval ? ` / ${plan.interval}` : "";
  const unit = `${money(plan.amount, plan.currency)} per writer${per}`;
  if (plan.seats === null || plan.seats === undefined) {
    return { unit, total: null };
  }
  const seats = Math.max(1, plan.seats);
  return {
    unit,
    total: `${seats} ${seats === 1 ? "writer" : "writers"} today: ${money(
      plan.amount * seats,
      plan.currency,
    )}${per}`,
  };
}

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
  const price = plan ? describePlanPrice(plan) : null;
  return (
    <section className="bs-panel plan-offer" aria-label="Bindersnap Pro">
      <div className="plan-offer-head">
        <div>
          <h3 className="plan-offer-name">Bindersnap Pro</h3>
          <p className="plan-offer-for">For everyone in {organizationName}</p>
        </div>
        {price ? (
          <div className="plan-offer-pricing">
            <p className="plan-offer-price">{price.unit}</p>
            {price.total ? (
              <p className="plan-offer-total">{price.total}</p>
            ) : null}
          </div>
        ) : (
          <p className="plan-offer-price">
            You’ll see the price before you pay
          </p>
        )}
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
            ? "Reading and exporting stay free, subscribed or not. Checkout is handled by Stripe."
            : `Only an owner of ${organizationName} can subscribe. Reading and exporting stay free, subscribed or not.`}
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
