/**
 * Word's AutoRecover, for a policy open in the editor.
 *
 * Save is a commit to the author's draft, so it is theirs to press — but a
 * tab that crashes, a laptop that dies, or a Close answered wrong in a hurry
 * should not cost an hour's writing. While there are unsaved words they are
 * kept here, on this device, a second after each change; the next time the
 * same policy is opened in the same draft they are offered back.
 *
 * **On this device only, and never on the record.** The copy is this
 * browser's, never sent anywhere, and dropped the moment the words are saved
 * or deliberately thrown away. Storage that is full or off (a private window)
 * just means no copy — nothing here may stop somebody writing.
 */

export interface RecoveredWords {
  /** The document as it was, the editor's JSON. */
  doc: unknown;
  /** When it was kept, ISO. */
  at: string;
  /**
   * The saved version it was typed on top of, as the editor's JSON string.
   * If the policy has been saved differently since, the recovery says so.
   */
  base: string;
}

const PREFIX = "bindersnap:recover:";

export function recoveryKey(
  org: string,
  binder: string,
  draft: string,
  slugPath: string,
): string {
  return `${PREFIX}${org}/${binder}/${draft}/${slugPath}`;
}

export function keepWords(
  key: string,
  doc: unknown,
  base: string,
  now = new Date(),
): void {
  try {
    const entry: RecoveredWords = { doc, at: now.toISOString(), base };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Full, or off. No copy, and nothing else changes.
  }
}

export function readWords(key: string): RecoveredWords | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveredWords>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.at !== "string" ||
      typeof parsed.base !== "string" ||
      typeof parsed.doc !== "object" ||
      parsed.doc === null
    ) {
      return null;
    }
    return parsed as RecoveredWords;
  } catch {
    return null;
  }
}

export function dropWords(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to drop.
  }
}

/**
 * Whether a kept copy is worth offering: it says something the saved
 * version does not.
 */
export function worthOffering(
  kept: RecoveredWords | null,
  saved: string,
): kept is RecoveredWords {
  return kept !== null && JSON.stringify(kept.doc) !== saved;
}
