import { publicEnv } from "../app/publicEnv";

/**
 * Where the app is, from the public site: Sign in, Sign up, and the landing
 * page's email box all lead there. Two origins, bindersnap.com for the site
 * and app.bindersnap.com for the app (issue #718), so every such link is
 * absolute.
 *
 * `BUN_PUBLIC_APP_URL` points the links at another app: the local stack sets
 * it to its own APP_PORT. Unset, they name production. Read through
 * `publicEnv()` so the same code works in the build scripts, the dev server
 * and the landing page's browser bundle.
 */
export const PRODUCTION_APP_URL = "https://app.bindersnap.com";

export function appOrigin(): string {
  return (
    publicEnv(() => process.env.BUN_PUBLIC_APP_URL) || PRODUCTION_APP_URL
  ).replace(/\/+$/, "");
}

export function appUrl(path: string): string {
  return `${appOrigin()}${path}`;
}

/**
 * The landing page is static HTML, so its links name production, which is
 * what a reader with no JavaScript needs. Where the app is somewhere else
 * (the local stack), point them there.
 */
export function retargetAppLinks(root: ParentNode = document): void {
  const origin = appOrigin();
  if (origin === PRODUCTION_APP_URL) return;
  for (const link of root.querySelectorAll<HTMLAnchorElement>(
    `a[href^="${PRODUCTION_APP_URL}/"]`,
  )) {
    const href = link.getAttribute("href") ?? "";
    link.setAttribute(
      "href",
      `${origin}${href.slice(PRODUCTION_APP_URL.length)}`,
    );
  }
}
