import { publicEnv } from "./publicEnv";

/**
 * An address on the public site — help, legal, the landing page — from the
 * app. They are two origins (bindersnap.com and app.bindersnap.com), so a
 * bare `/help` here would be an organization named "help".
 *
 * `BUN_PUBLIC_SITE_URL` is the site's origin: set by static-site.yml for
 * production and by docker-compose.yml for the local stack. Unset (unit
 * tests), the path stays relative.
 */
export function siteUrl(path: string): string {
  const origin = publicEnv(() => process.env.BUN_PUBLIC_SITE_URL).replace(
    /\/+$/,
    "",
  );
  return `${origin}${path}`;
}
