/**
 * Which Terms and Privacy Policy a person agrees to when they sign up.
 *
 * Shared between the app, which sends it with the signup, and the API, which
 * refuses any other and records it. Change it in the same commit as the words
 * in `apps/legal/documents/`: a test holds the two together, so an edit to the
 * Terms cannot ship while signups still record agreement to the old ones.
 */
export const LEGAL_VERSION = "2026-10-07";

export const TERMS_PATH = "/legal/terms";
export const PRIVACY_PATH = "/legal/privacy";
