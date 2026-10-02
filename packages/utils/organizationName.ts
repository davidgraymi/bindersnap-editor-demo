/**
 * Turning what someone typed into a name Gitea will accept.
 *
 * Shared between the API, which derives the organization's Gitea username from
 * it, and the app, which shows the person what their URL will be before they
 * commit to it. Two copies of this rule would drift, and the drift would show
 * up as a name the preview promised and the server did not give.
 */

/**
 * First path segments an organization cannot have.
 *
 * The app's own pages live behind `/-/` — `/-/documents`, `/-/login`,
 * `/-/user_settings/profile` — the way GitLab keeps its own, and no
 * organization can be called `-`. So almost every name is an organization's
 * to take. What is left is what the app cannot move: the help pages, which
 * are a separate site at `/help`; `/auth/callback`, where Gitea's sign-in
 * sends people back; and the files every browser asks for at the root.
 */
export const RESERVED_ORGANIZATION_NAMES: ReadonlySet<string> = new Set([
  "-",
  "auth",
  "help",
  "llms.txt",
  "apple-touch-icon.png",
  "favicon.ico",
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "og-image.png",
  "site.webmanifest",
]);

/** Gitea usernames and organization names share one namespace. */
export const MAX_ORGANIZATION_NAME_LENGTH = 40;

/**
 * Reduce a display name to something Gitea will accept as an org username:
 * alphanumerics, dash, underscore and dot, not starting or ending with a
 * separator.
 */
export function slugifyOrganizationName(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_ORGANIZATION_NAME_LENGTH)
    .replace(/[-._]+$/, "");
}
