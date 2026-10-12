/**
 * Cloudflare Turnstile, the check that a person and not a script is filling in
 * a form. Two forms use it, each with its own widget and site key: Send
 * feedback (the feedback Worker checks the token) and signup (the API does).
 *
 * The widget appears only when Turnstile wants a click; most people never see
 * it. No pre-clearance cookie: the Privacy Policy promises the app sets one
 * cookie, the session's.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** The part of Turnstile's browser API used here. */
interface Turnstile {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "always" | "execute" | "interaction-only";
      theme: "auto" | "light" | "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading: Promise<Turnstile> | null = null;

/** Turnstile's script, loaded the first time a form needs it and kept. */
function loadTurnstile(): Promise<Turnstile> {
  const ready = (window as { turnstile?: Turnstile }).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      const turnstile = (window as { turnstile?: Turnstile }).turnstile;
      if (turnstile) resolve(turnstile);
      else reject(new Error("Turnstile did not load."));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile did not load."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Ask for a new token: each one works once. */
  reset(): void;
  remove(): void;
}

/**
 * Put a Turnstile check in `container`, and tell `onToken` each token it
 * issues, or `null` when the last one expired or the check failed.
 */
export async function mountTurnstile(
  container: HTMLElement,
  siteKey: string,
  onToken: (token: string | null) => void,
): Promise<TurnstileHandle> {
  const turnstile = await loadTurnstile();
  const id = turnstile.render(container, {
    sitekey: siteKey,
    appearance: "interaction-only",
    theme: "auto",
    callback: (token) => onToken(token),
    "expired-callback": () => onToken(null),
    "error-callback": () => onToken(null),
  });
  return {
    reset: () => {
      onToken(null);
      turnstile.reset(id);
    },
    remove: () => turnstile.remove(id),
  };
}

/**
 * A Turnstile check for a form: attach `box` to an empty element where the
 * widget may draw itself, send `token` with the form, and call `reset` after
 * every submission — a token is spent once the server has checked it, whether
 * or not the rest of the form went through.
 *
 * An empty `siteKey` mounts nothing: a build with no widget configured (the
 * local stack, CI) has no check to pass, and `token` stays `null`.
 */
export function useTurnstile(siteKey: string): {
  box: React.RefObject<HTMLDivElement | null>;
  token: string | null;
  /** The script would not load: a blocker, or no network to Cloudflare. */
  failed: boolean;
  reset: () => void;
} {
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<TurnstileHandle | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = box.current;
    if (!siteKey || !container) return;
    let cancelled = false;
    mountTurnstile(container, siteKey, (next) => {
      if (!cancelled) setToken(next);
    })
      .then((mounted) => {
        if (cancelled) mounted.remove();
        else handle.current = mounted;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      handle.current?.remove();
      handle.current = null;
    };
  }, [siteKey]);

  const reset = useCallback(() => handle.current?.reset(), []);

  return { box, token, failed, reset };
}
