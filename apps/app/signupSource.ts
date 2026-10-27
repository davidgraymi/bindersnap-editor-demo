import {
  cleanSignupSource,
  signupSourceFromQuery,
  type SignupSource,
} from "../../packages/utils/signupSource";

/**
 * Where a signup came from, as the public site's link to `/-/signup` said
 * (`packages/utils/signupSource.ts`). Kept for this tab, so a person who
 * goes to sign in and back, or whose first try fails, still sends it.
 */
const KEY = "bindersnap.signupSource";

/** Keep what this address's query says, if it says anything. */
export function rememberSignupSource(search: string): void {
  const source = signupSourceFromQuery(search);
  if (!source) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(source));
  } catch {
    // Private mode: the signup goes ahead without it.
  }
}

/** What was kept, cleaned again, or null. */
export function rememberedSignupSource(): SignupSource | null {
  try {
    return cleanSignupSource(
      JSON.parse(window.sessionStorage.getItem(KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}
