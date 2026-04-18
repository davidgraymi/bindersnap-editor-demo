import { isHomePath } from "./routes";

export const DEFAULT_WAITLIST_COUNT = 247;
export type WaitlistSource = "hero" | "cta";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function showLandingContent(
  landingContent: HTMLElement | null | undefined,
): void {
  if (!landingContent) {
    return;
  }

  landingContent.style.display = "";
  landingContent.style.opacity = "1";
  landingContent.removeAttribute("aria-hidden");
}

export function hideLandingContent(
  landingContent: HTMLElement | null | undefined,
): void {
  if (!landingContent) {
    return;
  }

  landingContent.style.opacity = "0";
  landingContent.style.display = "none";
  landingContent.setAttribute("aria-hidden", "true");
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

export function setWaitlistCount(doc: Document, count: number): number {
  doc.getElementById("waitlist-count")!.textContent = String(count);
  doc.getElementById("nav-count")!.textContent = `${count} on the waitlist`;
  return count;
}

export function handleWaitlistSignup(
  doc: Document,
  source: WaitlistSource,
  count: number,
): number {
  const input = doc.getElementById(
    `${source}-email`,
  ) as HTMLInputElement | null;
  if (!input) {
    return count;
  }

  const email = input.value.trim();
  if (!email || !email.includes("@")) {
    input.style.outline = "2px solid rgba(232,93,38,0.6)";
    input.focus();
    window.setTimeout(() => {
      input.style.outline = "";
    }, 1500);
    return count;
  }

  doc.getElementById(
    source === "hero" ? "hero-form" : "cta-form",
  )!.style.display = "none";
  doc.getElementById(
    source === "hero" ? "hero-success" : "cta-success",
  )!.style.display = "flex";

  for (const hint of doc.querySelectorAll(".form-hint, .cta-hint")) {
    (hint as HTMLElement).style.display = "none";
  }

  return setWaitlistCount(doc, count + 1);
}

export function bindWaitlistEnterKeys(
  doc: Document,
  submit: (source: WaitlistSource) => void,
): void {
  for (const id of ["hero-email", "cta-email"]) {
    doc.getElementById(id)?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit(id.replace("-email", "") as WaitlistSource);
      }
    });
  }
}

export function installScrollReveal(doc: Document = document): void {
  if (typeof IntersectionObserver === "undefined") {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1 },
  );

  for (const element of doc.querySelectorAll(".reveal")) {
    observer.observe(element);
  }
}

export function shouldShowLanding(pathname: string): boolean {
  return isHomePath(pathname);
}
