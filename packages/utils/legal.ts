/**
 * Which Terms and Privacy Policy a person agrees to, and the words they tick.
 *
 * Shared between the app, which sends the version with each agreement, and
 * the API, which refuses any other and records it. Change it in the same
 * commit as the words in `apps/legal/documents/` or in `AGREEMENT_WORDS`: a
 * test holds them together, so an edit to the Terms or to a checkbox cannot
 * ship while agreements still record the old version.
 */
export const LEGAL_VERSION = "2026-10-07";

/**
 * The last version everybody has to accept again: people for themselves, and
 * owners for their organizations.
 *
 * Move it to `LEGAL_VERSION` only for a material change (Terms §18). A typo
 * fix moves `LEGAL_VERSION` alone, and nobody is asked again. An account or
 * organization whose latest agreement is older than this is asked, in the
 * app, before it can go on.
 */
// Versions are ISO dates, so comparing them as strings orders them by date.
export const LEGAL_ACCEPT_AGAIN_VERSION = "2026-10-07";

export const TERMS_PATH = "/legal/terms";
export const PRIVACY_PATH = "/legal/privacy";

/**
 * The checkbox sentences, as the form shows them around the two links.
 *
 * `{terms}` and `{privacy}` mark where the links go, and `{organization}` the
 * organization's name. The record stores only the version, so these words are
 * part of what a version means.
 */
export const AGREEMENT_WORDS = {
  person:
    "I agree to the {terms}, I've read the {privacy}, and I won't put patient health information in Bindersnap.",
  organization:
    "I accept the {terms} for {organization}, and I'm authorized to do that for it.",
} as const;

export type AgreementScope = keyof typeof AGREEMENT_WORDS;
