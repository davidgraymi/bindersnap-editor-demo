/**
 * A group's name, in the two forms it has to exist in.
 *
 * A group is a Gitea team, and a team's name is the only name it has — Gitea
 * has no display-name field for one. That name also has to survive being
 * written into `.gitea/CODEOWNERS` as `@org/team`, which Gitea parses by
 * splitting on whitespace, so a group called "Quality Committee" could never be
 * named in a sign-off rule.
 *
 * So the stored name is a handle — `quality-committee` — and the name on screen
 * is **derived** from it rather than kept beside it. A second stored copy would
 * be a table shadowing a Gitea object, which is the thing ADR 0004 refuses, and
 * it would drift the first time somebody renamed the team in Gitea.
 *
 * Shared between the API, which creates the team, and the app, which shows
 * somebody the handle before they commit to it. Two copies of this rule would
 * disagree, and the disagreement would show up as a name the form promised and
 * the server did not give.
 */

/** Gitea rejects a team name longer than this. */
export const MAX_GROUP_NAME_LENGTH = 30;

/**
 * Reduce what somebody typed to a name Gitea will accept as a team: lowercase
 * alphanumerics and dashes, not starting or ending with one.
 *
 * Deliberately narrower than `slugifyOrganizationName`, which keeps dots and
 * underscores. A group name is written into CODEOWNERS, and the fewer
 * characters that can appear there the fewer ways a generated rule can be
 * misread.
 */
export function slugifyGroupName(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_GROUP_NAME_LENGTH)
    .replace(/-+$/, "");
}

/**
 * The handle, said the way a person would say it.
 *
 * Purely derived, so it is always in step with the team Gitea holds. Gitea's
 * own built-in names are left exactly as they are: "Owners" is already how that
 * team is spelled everywhere else in Gitea, in our code and in ADR 0004, and
 * re-spelling it would make the same team look like two.
 */
export function describeGroupName(handle: string): string {
  if (handle === "" || /[A-Z]/.test(handle)) return handle;

  return handle
    .split(/[-_.]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
