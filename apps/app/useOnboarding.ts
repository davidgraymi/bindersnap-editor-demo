import { useCallback, useEffect, useRef, useState } from "react";

import { fetchOnboarding, type OnboardingPayload } from "./api";

/**
 * The getting-started state, kept fresh without asking on every click.
 *
 * Read again when the page changes — adding a binder happens on another page,
 * and the guide should have moved on by the time somebody comes back — but no
 * more than every few seconds, and again when the window comes back into
 * focus. Hiding the guide is a per-person, per-device preference, which is
 * what browser storage is for; the progress itself is never stored.
 */

const MIN_GAP_MS = 5_000;

function hiddenKey(username: string): string {
  return `bindersnap.guide.hidden.${username}`;
}

function readHidden(username: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(username)) === "1";
  } catch {
    return false;
  }
}

export function useOnboarding(username: string, routeKey: string) {
  const [state, setState] = useState<OnboardingPayload | null>(null);
  const [hidden, setHiddenState] = useState(() => readHidden(username));
  const last = useRef(0);

  const refresh = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - last.current < MIN_GAP_MS) return;
    last.current = now;
    fetchOnboarding()
      .then(setState)
      // A guide that cannot be read is a guide that is not shown.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!username) return;
    refresh();
  }, [username, routeKey, refresh]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const setHidden = useCallback(
    (next: boolean) => {
      setHiddenState(next);
      try {
        if (next) window.localStorage.setItem(hiddenKey(username), "1");
        else window.localStorage.removeItem(hiddenKey(username));
      } catch {
        // Not remembered on this device; still hidden for now.
      }
    },
    [username],
  );

  return { state, hidden, setHidden, refresh };
}
