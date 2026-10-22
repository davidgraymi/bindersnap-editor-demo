import { createContext, useCallback, useContext } from "react";

import { useIsReadOnly } from "./readOnlyContext";

/**
 * The one paywall, reachable from anywhere a write starts.
 *
 * **Every way in meets the same offer.** A refused write used to flip the app
 * into read-only and hide the buttons; a customer who went looking for "New
 * binder" found nothing, and the banner's "Restore access" led to a page with
 * one button. The moment someone reaches for a thing they cannot do is the
 * moment to say what it costs and what it gets them, so the create buttons
 * stay where they are and open this instead.
 */
export interface Paywall {
  open: () => void;
}

const PaywallContext = createContext<Paywall>({ open: () => undefined });

export const PaywallProvider = PaywallContext.Provider;

export function usePaywall(): Paywall {
  return useContext(PaywallContext);
}

/**
 * `action`, unless the organization is read-only — then the paywall.
 *
 * For the buttons that start something: they stay drawn while the
 * organization cannot write, because a missing button explains nothing and
 * an offer does.
 */
export function useWriteAction<Args extends unknown[]>(
  action: (...args: Args) => void,
): (...args: Args) => void {
  const readOnly = useIsReadOnly();
  const { open } = usePaywall();
  return useCallback(
    (...args: Args) => (readOnly ? open() : action(...args)),
    [readOnly, open, action],
  );
}
