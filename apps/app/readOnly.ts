/**
 * Read-only mode — what a delinquent organization looks like from the screen.
 *
 * ADR 0004 is structural about this: the paywall gates authoring and mutation
 * and never gates reading or exporting. The API has enforced that since #392,
 * but the SPA answered a lapsed subscription by replacing the whole app with
 * the card form, so no customer could reach the record the rule promises to
 * keep open. This is the other half — the app renders, the record is legible,
 * and the controls that would write are gone with a sentence saying why.
 *
 * It bites the organization, not the person: a reviewer in a delinquent org is
 * read-only too, because the org is delinquent and they are not.
 */
export type ReadOnlyState = {
  readOnly: boolean;
  /**
   * Whose bill it is. A person who belongs to two organizations learns
   * nothing from "your subscription has lapsed", so the banner names one.
   */
  organizationName: string | null;
};

export const NOT_READ_ONLY: ReadOnlyState = {
  readOnly: false,
  organizationName: null,
};

/**
 * Decide read-only from what the billing status actually said.
 *
 * Three cases are deliberately *not* read-only:
 *
 * - **No session.** There is nothing to be read-only about.
 * - **No organization** (`accessSource === "no_organization"`). Nothing has
 *   lapsed and there is nothing to buy; authoring asks for an organization
 *   instead, which `handlePaymentRequired` already does.
 * - **We could not check** (`hasBillingStatusError`). Refusing to draw a
 *   paying customer's controls because Stripe was briefly unreachable is a
 *   worse failure than drawing them, and it is not a real risk: the API is
 *   the gate, so a mutation that should be refused still is — and its typed
 *   402 turns the banner on for real.
 */
export function resolveReadOnly(input: {
  isSignedIn: boolean;
  subscriptionStatus: "active" | "none" | "loading" | null;
  accessSource: string | null;
  hasBillingStatusError: boolean;
  organizationName: string | null;
}): ReadOnlyState {
  if (
    !input.isSignedIn ||
    input.subscriptionStatus !== "none" ||
    input.hasBillingStatusError ||
    input.accessSource === "no_organization"
  ) {
    return NOT_READ_ONLY;
  }

  return { readOnly: true, organizationName: input.organizationName };
}

/**
 * What the banner says.
 *
 * Named rather than inlined so the wording is one string in one place — it is
 * the only thing standing between a customer and "why can I not click
 * anything", and it appears on every page in the app.
 */
export function describeReadOnly(state: ReadOnlyState): string {
  const whose = state.organizationName
    ? `${state.organizationName}'s subscription`
    : "This organization's subscription";

  return `${whose} has lapsed, so changes are paused. Everything here stays readable and exportable — nothing has been taken away.`;
}
