import { useCallback, useEffect, useState } from "react";

/**
 * Whether the navigation is down to its icons, remembered between visits.
 *
 * **A preference about the window, not about the work.** Somebody reading a
 * long policy on a laptop wants the page and not the map; somebody moving
 * around the product wants the map. Which of those they are doing changes
 * through the day, so it is a control rather than a breakpoint — and once
 * they have set it, asking again on every page load is the thing that would
 * make it annoying.
 *
 * Local to the browser, for the reason {@link useCollapsedFolders} gives about
 * shut folders: it changes nothing about the record, it is worthless to
 * anybody else, and storage that is unavailable costs the memory of the
 * preference and nothing more.
 */

const STORAGE_KEY = "bindersnap.sidebar.collapsed";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private browsing or a disabled store. Open is the right default: it is
    // the state that shows somebody what the product has in it.
    return false;
  }
}

export function useCollapsedSidebar(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(read);

  useEffect(() => {
    try {
      if (collapsed) window.localStorage.setItem(STORAGE_KEY, "1");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Forgetting the preference is not worth a broken page.
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((was) => !was), []);

  return { collapsed, toggle };
}
