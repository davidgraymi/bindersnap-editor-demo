import { useRememberedToggle } from "./useRememberedToggle";

/**
 * Whether the navigation is down to its icons, remembered between visits.
 *
 * See {@link useRememberedToggle} for why a shut panel is remembered at all
 * and why it is remembered in the browser.
 */

const STORAGE_KEY = "bindersnap.sidebar.collapsed";

export function useCollapsedSidebar(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const { on, toggle } = useRememberedToggle(STORAGE_KEY);
  return { collapsed: on, toggle };
}
