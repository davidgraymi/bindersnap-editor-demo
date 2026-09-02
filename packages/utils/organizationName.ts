/**
 * Turning what someone typed into a name Gitea will accept.
 *
 * Shared between the API, which derives the organization's Gitea username from
 * it, and the app, which shows the person what their URL will be before they
 * commit to it. Two copies of this rule would drift, and the drift would show
 * up as a name the preview promised and the server did not give.
 */

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
