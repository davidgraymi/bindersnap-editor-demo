import { randomInt } from "node:crypto";

/**
 * The Gitea login a new account gets when the signup form does not ask for
 * one.
 *
 * A compliance lead has no reason to know what a username is for — it is
 * Gitea's, not hers — so the form asks for her name and email and this makes
 * the login from her name: `Jordan Kim` signs up as `jordan.kim`. She signs in
 * with her email. The login still shows in people lists and mentions, which is
 * why it is built from the name rather than the address: it reads as a person,
 * not as a mailbox.
 */

/** Gitea's limit on a user name. */
const MAX_USERNAME_LENGTH = 40;

/** Room left at the end for a suffix that makes a taken name free. */
const SUFFIX_ROOM = 5;

/** How many names to try before giving up on a signup. */
export const MAX_USERNAME_ATTEMPTS = 8;

/**
 * One part of a name as Gitea will take it: accents dropped, lowercased,
 * apostrophes removed (`O'Neil` is `oneil`), and anything else that is not a
 * letter or digit turned into a single dash.
 */
function namePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A login built from the person's name, or from their address when the name
 * has nothing Gitea accepts (a name written only in another script). Always
 * valid by Gitea's rules: letters and digits, single `.` or `-` between them,
 * never at either end.
 */
export function usernameFromName(
  firstName: string,
  lastName: string,
  email: string,
): string {
  const fromName = [namePart(firstName), namePart(lastName)]
    .filter(Boolean)
    .join(".");
  const fromEmail = namePart(email.split("@")[0] ?? "");
  const base = fromName || fromEmail || "member";

  return base.slice(0, MAX_USERNAME_LENGTH - SUFFIX_ROOM).replace(/[-.]+$/, "");
}

/**
 * The names to try, in order: the plain one, then a few numbered ones, then a
 * few with random digits so a common name cannot run out of tries.
 */
export function usernameCandidates(
  base: string,
  fourDigits: () => number = () => randomInt(1000, 10000),
): string[] {
  const numbered = [2, 3, 4, 5].map((n) => `${base}${n}`);
  const randomized = Array.from(
    { length: MAX_USERNAME_ATTEMPTS - 1 - numbered.length },
    () => `${base}${fourDigits()}`,
  );
  return [base, ...numbered, ...randomized];
}

/**
 * Whether Gitea refused the *name* rather than the account: the name is
 * taken (by a person or an organization — they share one namespace), or it
 * is one of Gitea's reserved names or patterns. A taken email is not one of
 * these: trying another name would not help.
 */
export function isUsernameRefusal(status: number, error: string): boolean {
  if (status !== 409 && status !== 422) return false;
  if (/e-?mail/i.test(error)) return false;
  return /user already exists|name is reserved|name pattern is not allowed/i.test(
    error,
  );
}

/**
 * Create the account under the first free name. `create` is the one call to
 * Gitea; any refusal other than a taken or reserved name is returned as it
 * came, so the person sees the same error they would have before.
 */
export async function createWithFreeUsername<
  Result extends { created: true } | { status: number; error: string },
>(
  candidates: readonly string[],
  create: (username: string) => Promise<Result>,
): Promise<{ username: string; result: Result }> {
  let last: { username: string; result: Result } | null = null;
  for (const username of candidates) {
    const result = await create(username);
    last = { username, result };
    if ("created" in result) return last;
    if (!isUsernameRefusal(result.status, result.error)) return last;
  }
  if (!last) {
    throw new Error("createWithFreeUsername needs at least one candidate.");
  }
  return last;
}
