import { trackEvent } from "./analytics";
import { appUrl } from "./appLink";

export type SignupSource = "hero" | "cta";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function restoreTheme(doc: Document = document): string {
  const storage = getStorage();
  const savedTheme = storage?.getItem("bs-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const nextTheme = savedTheme || (prefersDark ? "dark" : "light");

  doc.documentElement.setAttribute("data-theme", nextTheme);
  return nextTheme;
}

export function toggleTheme(doc: Document = document): string {
  const html = doc.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  const nextTheme = isDark ? "light" : "dark";

  html.setAttribute("data-theme", nextTheme);
  getStorage()?.setItem("bs-theme", nextTheme);
  return nextTheme;
}

export function buildSignupUrl(email: string | null | undefined): string {
  const params = new URLSearchParams();
  const normalizedEmail = email?.trim() ?? "";

  if (normalizedEmail) {
    params.set("email", normalizedEmail);
  }

  // The app's own origin (app.bindersnap.com), not this site's.
  const query = params.toString();
  return appUrl(query ? `/-/signup?${query}` : "/-/signup");
}

export function routeLandingSignup(
  doc: Document,
  source: SignupSource,
  navigate: (url: string) => void = (url) => {
    window.location.assign(url);
  },
): string {
  const input = doc.getElementById(
    `${source}-email`,
  ) as HTMLInputElement | null;
  const signupUrl = buildSignupUrl(input?.value);
  // Where on the page, and whether an address was typed: never the address.
  trackEvent("cta_click", {
    cta: source === "hero" ? "landing_hero" : "landing_closing",
    with_email: input?.value.trim() ? "yes" : "no",
  });
  navigate(signupUrl);
  return signupUrl;
}

export function bindSignupEnterKeys(
  doc: Document,
  submit: (source: SignupSource) => void,
): void {
  for (const id of ["hero-email", "cta-email"]) {
    doc.getElementById(id)?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit(id.replace("-email", "") as SignupSource);
      }
    });
  }
}

/** Reveal every `.reveal` element at once, skipping the scroll animation. */
function revealAll(doc: Document): void {
  for (const element of doc.querySelectorAll(".reveal")) {
    element.classList.add("in");
  }
}

export function installScrollReveal(doc: Document = document): void {
  // Without an observer there is nothing to drive the animation, and bailing
  // out would leave every section below the hero stuck at opacity 0.
  if (typeof IntersectionObserver === "undefined") {
    revealAll(doc);
    return;
  }

  const view = doc.defaultView;
  const pending = new Set(doc.querySelectorAll(".reveal"));

  const reveal = (element: Element, instant: boolean) => {
    if (!pending.delete(element)) return;
    if (instant) element.classList.add("reveal-instant");
    element.classList.add("in");
    observer.unobserve(element);
    if (pending.size === 0) view?.removeEventListener("scroll", onScroll);
  };

  // Starts a little below the fold, so a section has begun to appear by the
  // time it scrolls in rather than arriving blank on a fast scroll.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target, false);
      }
    },
    { rootMargin: "0px 0px 15% 0px", threshold: 0 },
  );

  // A jump (an anchor, the End key, a hard flick) can carry a section from
  // below the viewport to above it without it ever intersecting, and the
  // observer never hears of it. Anything that has ended up above the fold
  // is shown on the spot, so scrolling back up never meets blank space.
  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    view?.requestAnimationFrame(() => {
      queued = false;
      for (const element of pending) {
        if (element.getBoundingClientRect().bottom < 0) reveal(element, true);
      }
    });
  }

  for (const element of pending) {
    observer.observe(element);
  }
  view?.addEventListener("scroll", onScroll, { passive: true });
  // A page opened at #signup starts below everything before it.
  onScroll();
}
