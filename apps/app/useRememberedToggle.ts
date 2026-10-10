import { useCallback, useEffect, useState } from "react";

/**
 * A panel somebody has shut, remembered between visits.
 *
 * **A preference about the window, not about the work.** Somebody reading a
 * long policy on a laptop wants the page and not the map; somebody moving
 * around the product wants the map. Which of those they are doing changes
 * through the day, so it is a control rather than a breakpoint — and once they
 * have set it, asking again on every page load is the thing that would make it
 * annoying.
 *
 * Local to the browser, for the reason {@link useCollapsedFolders} gives about
 * shut folders: it changes nothing about the record, it is worthless to
 * anybody else, and storage that is unavailable costs the memory of the
 * preference and nothing more.
 *
 * Open is always the default. It is the state that shows somebody what the
 * product has in it, and a panel that starts hidden is a feature nobody finds.
 */

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Private browsing, or a disabled store.
    return false;
  }
}

export function useRememberedToggle(key: string): {
  on: boolean;
  toggle: () => void;
} {
  const [on, setOn] = useState<boolean>(() => read(key));

  // Re-read when the key changes: one of these outlives a navigation between
  // two things that each remember their own answer.
  useEffect(() => {
    setOn(read(key));
  }, [key]);

  useEffect(() => {
    try {
      if (on) window.localStorage.setItem(key, "1");
      else window.localStorage.removeItem(key);
    } catch {
      // Forgetting the preference is not worth a broken page.
    }
  }, [key, on]);

  const toggle = useCallback(() => setOn((was) => !was), []);

  return { on, toggle };
}
