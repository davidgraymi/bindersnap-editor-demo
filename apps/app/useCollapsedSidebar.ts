import { useEffect, useState } from "react";

import { useRememberedToggle } from "./useRememberedToggle";

/**
 * Whether the navigation is down to its icons, remembered between visits.
 *
 * See {@link useRememberedToggle} for why a shut panel is remembered at all
 * and why it is remembered in the browser.
 *
 * **Reading a policy collapses it on its own** (`narrow`). A document open in
 * the page puts three panels beside each other — the map of the product, the
 * binder's files, and the policy — and the one nobody is using is the map: the
 * customer, on opening a document, *"it should also collapse the side
 * navigation bar"*. It comes back the moment you leave, because this is a fact
 * about the page rather than a preference somebody set.
 *
 * Which is why an automatic collapse is not written down. Somebody who opens
 * the map back up while reading has it back for as long as they are reading,
 * and their standing answer to "do I want the map" is untouched — the
 * alternative teaches the product a preference nobody stated.
 */

const STORAGE_KEY = "bindersnap.sidebar.collapsed";

export function useCollapsedSidebar(narrow = false): {
  collapsed: boolean;
  toggle: () => void;
} {
  const { on, toggle } = useRememberedToggle(STORAGE_KEY);
  /** Said out loud while the page is narrow, overriding the automatic answer. */
  const [said, setSaid] = useState<boolean | null>(null);

  // Arriving at a document, and leaving one, both start the question again.
  useEffect(() => {
    setSaid(null);
  }, [narrow]);

  const collapsed = said ?? (narrow ? true : on);

  return {
    collapsed,
    toggle: () => {
      if (narrow) setSaid(!collapsed);
      else toggle();
    },
  };
}
