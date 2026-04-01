/**
 * Billing page — shows current plan status and links to Stripe Checkout / Customer Portal.
 *
 * The STRIPE_PAYMENT_LINK and STRIPE_PORTAL_URL come from env vars so they
 * can be set without code changes. Until they're configured, the buttons
 * show a placeholder state.
 */

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const PAYMENT_LINK = appEnv?.BUN_PUBLIC_STRIPE_PAYMENT_LINK ?? "";
const PORTAL_URL = appEnv?.BUN_PUBLIC_STRIPE_PORTAL_URL ?? "";

interface BillingPageProps {
  onClose: () => void;
}

export function BillingPage({ onClose }: BillingPageProps) {
  return (
    <section className="app-gate" style={{ alignItems: "flex-start", paddingTop: "var(--brand-space-12)" }}>
      <div className="app-gate-panel bs-card" style={{ maxWidth: 480, width: "100%" }}>
        <div className="bs-eyebrow">Billing</div>
        <h1>Manage your plan</h1>

        <dl style={{ marginBottom: "var(--brand-space-6)" }}>
          <div>
            <dt style={{ fontWeight: 600 }}>Current plan</dt>
            <dd>Free (local dev)</dd>
          </div>
        </dl>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--brand-space-3)" }}>
          {PAYMENT_LINK ? (
            <a
              href={PAYMENT_LINK}
              className="bs-btn bs-btn-primary app-submit"
              style={{ textAlign: "center", textDecoration: "none" }}
            >
              Upgrade — Pay with Stripe
            </a>
          ) : (
            <button
              className="bs-btn bs-btn-primary app-submit"
              type="button"
              disabled
              title="Set BUN_PUBLIC_STRIPE_PAYMENT_LINK to enable"
            >
              Upgrade (Stripe not configured)
            </button>
          )}

          {PORTAL_URL ? (
            <a
              href={PORTAL_URL}
              className="bs-btn bs-btn-secondary"
              style={{ textAlign: "center", textDecoration: "none" }}
              target="_blank"
              rel="noreferrer"
            >
              Manage subscription →
            </a>
          ) : null}

          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onClose}
          >
            Back
          </button>
        </div>

        <p style={{ marginTop: "var(--brand-space-4)", fontSize: "var(--brand-text-sm)", color: "var(--bs-text-secondary)" }}>
          Payments are processed securely by Stripe. Bindersnap never stores card details.
        </p>
      </div>
    </section>
  );
}
