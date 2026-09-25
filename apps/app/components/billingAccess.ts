/**
 * Which billing panel a session should see.
 *
 * ADR 0004 gives every new organization a 14-day trial with no card, so
 * "has access" and "has a subscription" came apart. `subscriptionStatus` only
 * answers the first — it reads "active" throughout a trial — and access alone
 * is not enough to decide what the billing page is for.
 */

/**
 * True when there is a real Stripe subscription to show and manage.
 *
 * A trialing organization has access and no subscription, so answering true
 * for it would offer a portal for a Stripe customer that does not exist and
 * hide the only control that could create one.
 */
export function hasManageableSubscription(
  subscriptionStatus: "active" | "none" | "loading",
  accessSource: string | null,
): boolean {
  return subscriptionStatus === "active" && accessSource === "stripe";
}

/** Seconds since the epoch, as the billing API gives them, as "Oct 9, 2026". */
function formatBillingDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface BillingSummaryInput {
  subscriptionStatus: "active" | "none" | "loading";
  accessSource: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  trialEndsAt: number | null;
}

export interface BillingSummary {
  /** One word for the badge: where the organization stands. */
  standing: string;
  tone: "approved" | "review" | "changes" | "working";
  /** The sentence under it: what that means, and until when. */
  detail: string;
  /** The one thing to do about it, if there is one. */
  action: "manage" | "subscribe" | null;
}

/**
 * What the billing page says about an organization, in one badge and one
 * sentence.
 *
 * **Every way in to access gets its own answer.** The page used to know two
 * states — paying, or "Start your subscription" — so an organization on a
 * complimentary grant was told to subscribe, and one on a trial was never
 * told when the trial ends.
 */
export function describeBilling(input: BillingSummaryInput): BillingSummary {
  const { accessSource } = input;

  if (hasManageableSubscription(input.subscriptionStatus, accessSource)) {
    const detail = input.cancelAtPeriodEnd
      ? input.cancelAt !== null
        ? `Cancels on ${formatBillingDate(input.cancelAt)}. Until then everything works as it does now.`
        : "Cancels at the end of the billing period."
      : input.currentPeriodEnd !== null
        ? `Renews on ${formatBillingDate(input.currentPeriodEnd)}.`
        : "Paid and active.";
    return {
      standing: input.cancelAtPeriodEnd ? "Cancelling" : "Active",
      tone: input.cancelAtPeriodEnd ? "review" : "approved",
      detail,
      action: "manage",
    };
  }

  if (input.subscriptionStatus === "active") {
    if (accessSource === "trial") {
      return {
        standing: "Trial",
        tone: "review",
        detail:
          input.trialEndsAt !== null
            ? `Free trial until ${formatBillingDate(input.trialEndsAt)}. Subscribe before then to keep writing.`
            : "On a free trial. Subscribe to keep writing when it ends.",
        action: "subscribe",
      };
    }
    // A grant from us, or this environment's own exemption: access with no
    // bill behind it, and nothing to buy.
    return {
      standing: "Complimentary",
      tone: "approved",
      detail:
        accessSource === "config_bypass"
          ? "This environment exempts your account from billing. There is nothing to pay."
          : "Bindersnap has granted this organization access. There is nothing to pay.",
      action: null,
    };
  }

  if (accessSource === "admin_revoke") {
    return {
      standing: "Suspended",
      tone: "changes",
      detail:
        "Bindersnap has suspended this organization's access. Everything can still be read; nothing can be changed.",
      action: null,
    };
  }

  if (accessSource === "no_organization") {
    return {
      standing: "No organization",
      tone: "working",
      detail: "Billing belongs to an organization, and you are not in one yet.",
      action: null,
    };
  }

  return {
    standing: "Inactive",
    tone: "changes",
    detail:
      "No active subscription. Everything can still be read; nothing can be changed until one starts.",
    action: "subscribe",
  };
}
