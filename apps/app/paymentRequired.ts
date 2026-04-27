import { useLayoutEffect } from "react";

const paymentRequiredHandlers = new Set<() => void>();

export function registerPaymentRequiredHandler(
  handler: () => void,
): () => void {
  paymentRequiredHandlers.add(handler);

  return () => {
    paymentRequiredHandlers.delete(handler);
  };
}

export function notifyPaymentRequired(): void {
  for (const handler of paymentRequiredHandlers) {
    handler();
  }
}

export function shouldInterceptPaymentRequired(path: string): boolean {
  return !(path === "/api/app/billing" || path.startsWith("/api/app/billing/"));
}

export function usePaymentRequiredHandler(handler: () => void): void {
  useLayoutEffect(() => registerPaymentRequiredHandler(handler), [handler]);
}
