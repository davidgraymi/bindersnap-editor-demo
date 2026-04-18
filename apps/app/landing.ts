import { isHomePath } from "./routes";

export type SignupSource = "hero" | "cta";

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

export function buildSignupUrl(email: string | null | undefined): string {
  const params = new URLSearchParams({ mode: "signup" });
  const normalizedEmail = email?.trim() ?? "";

  if (normalizedEmail) {
    params.set("email", normalizedEmail);
  }

  return `/login?${params.toString()}`;
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
