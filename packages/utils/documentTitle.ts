/**
 * What to call a document, given only what its file is called.
 *
 * The title is the filename (ADR 0005 §4) — a slug, so the casing somebody
 * typed is already gone by the time anything reads it. This is the one rule
 * that turns it back into a heading, and it lives here rather than in the app
 * because the API needs the same answer: the title stamped into a version's tag
 * has to be the title the product shows, or a surveyor holding a `git tag -n1`
 * and a screenshot is holding two different names for one policy.
 */

/**
 * Initialisms this product's own documents are named after.
 *
 * "hipaa-training-policy" title-cased word by word reads "Hipaa Training
 * Policy", which is a machine visibly guessing at the name of a regulation on a
 * page whose whole job is to be trustworthy.
 *
 * This list is a stopgap, not the fix. The fix is storing the title a person
 * typed instead of deriving one from the slug — ADR 0005 says so in as many
 * words and is deliberately shaped so that a sidecar carrying one can be added
 * later without a migration. Until a document carries its own name, this at
 * least stops the guess being wrong about the words the ICP uses every day.
 */
const INITIALISMS = new Set([
  "cdc",
  "dpa",
  "ehr",
  "hipaa",
  "hr",
  "it",
  "osha",
  "pdf",
  "phi",
  "ppe",
  "sop",
]);

/** "quarterly-report" → "Quarterly Report"; "hipaa-training" → "HIPAA Training". */
export function formatDocumentName(slug: string): string {
  return slug
    .split("-")
    .map((word) =>
      INITIALISMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}
