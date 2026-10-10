import { useLayoutEffect } from "react";

/**
 * What a refused write tells the app.
 *
 * The organization is carried because the banner names whose bill it is, and
 * a person in two organizations cannot work that out for themselves.
 */
export type PaymentRequiredEvent = {
  organizationName: string | null;
};

const paymentRequiredHandlers = new Set<
  (event: PaymentRequiredEvent) => void
>();

export function registerPaymentRequiredHandler(
  handler: (event: PaymentRequiredEvent) => void,
): () => void {
  paymentRequiredHandlers.add(handler);

  return () => {
    paymentRequiredHandlers.delete(handler);
  };
}

export function notifyPaymentRequired(event: PaymentRequiredEvent): void {
  for (const handler of paymentRequiredHandlers) {
    handler(event);
  }
}

/**
 * Is this 402 the paywall talking?
 *
 * It is when the body says so. `GET /api/app/billing` answers 402 with a
 * whole billing status when an organization is delinquent — that is data, not
 * a refusal, and treating it as one put the app into read-only mode from the
 * very page that exists to get out of it.
 *
 * This used to be decided by matching the request path, which meant every new
 * billing route had to remember to add itself to a list here or break the
 * page. The server states it now (`code: "subscription_required"`), so the
 * question is answered rather than guessed.
 */
export function isPaywallResponse(
  body: unknown,
): body is { code: "subscription_required"; organization?: string | null } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "subscription_required"
  );
}

export function usePaymentRequiredHandler(
  handler: (event: PaymentRequiredEvent) => void,
): void {
  useLayoutEffect(() => registerPaymentRequiredHandler(handler), [handler]);
}
