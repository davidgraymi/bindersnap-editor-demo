/**
 * Where a signup came from, carried on the link to the app's signup page so
 * the API can keep it beside the account (`packages/utils/signupSource.ts`).
 * First-party, and independent of Google Analytics: it runs whether or not
 * the tag does, and nothing it records goes to Google.
 *
 * The first page of a visit remembers, for this tab only (`sessionStorage`),
 * where the visit began, the other site that sent it, and any campaign tags
 * on its address. Every link to `/-/signup` then carries those, and the page
 * it is on as `from`.
 */
const KEY = "bs-entry";

/**
 * Remembers the visit's start, then tags the page's signup links. Written to
 * run as the page's own inline script (`SIGNUP_SOURCE_SCRIPT`), so it uses
 * nothing from outside its own body.
 */
export function tagSignupLinks(win: Window): void {
  try {
    const doc = win.document;
    let entry: Record<string, string> | null = null;
    try {
      entry = JSON.parse(win.sessionStorage.getItem("bs-entry") || "null");
    } catch (_) {
      entry = null;
    }
    if (!entry || typeof entry !== "object") {
      entry = { entry: win.location.pathname };
      try {
        const host = new URL(doc.referrer).hostname;
        if (
          host &&
          host !== win.location.hostname &&
          !/(^|\.)bindersnap\.com$/.test(host)
        ) {
          entry.ref = host;
        }
      } catch (_) {
        // No referrer, or not an address.
      }
      const query = new URLSearchParams(win.location.search);
      for (const name of ["utm_source", "utm_medium", "utm_campaign"]) {
        const value = query.get(name);
        if (value) entry[name] = value.slice(0, 100);
      }
      try {
        win.sessionStorage.setItem("bs-entry", JSON.stringify(entry));
      } catch (_) {
        // Private mode: this page's links still carry it.
      }
    }
    const params = entry;
    const tag = () => {
      const links = doc.querySelectorAll('a[href*="/-/signup"]');
      for (let i = 0; i < links.length; i++) {
        const link = links[i] as HTMLAnchorElement;
        const url = new URL(link.href, win.location.href);
        for (const name of Object.keys(params)) {
          url.searchParams.set(name, String(params[name]));
        }
        url.searchParams.set("from", win.location.pathname);
        link.href = url.toString();
      }
    };
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", tag);
    } else {
      tag();
    }
  } catch (_) {
    // Never in the way of the page.
  }
}

/** The same, as an inline script for a page's `<head>`. */
export const SIGNUP_SOURCE_SCRIPT = `(${tagSignupLinks.toString()})(window);`;

/**
 * The parameters a signup link carries from this page, for a link built by
 * script rather than written in the page (the landing page's email box).
 */
export function signupSourceParams(win: Window): URLSearchParams {
  const params = new URLSearchParams();
  try {
    const entry = JSON.parse(win.sessionStorage.getItem(KEY) || "null");
    if (entry && typeof entry === "object") {
      for (const [name, value] of Object.entries(entry)) {
        if (typeof value === "string") params.set(name, value);
      }
    }
  } catch {
    // Nothing remembered.
  }
  params.set("from", win.location.pathname);
  return params;
}
