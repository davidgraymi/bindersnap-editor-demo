/**
 * A new document started from the editor's file panel: made at once, blank,
 * and named "Untitled" — as a new file is in Word, Google Docs or an IDE —
 * rather than asked about in a dialog first. It is renamed from its title or
 * its row like any other.
 */

export const UNTITLED = "Untitled";

/**
 * "Untitled", then "Untitled 2", "Untitled 3" when those are taken in the
 * folder it goes into. `taken` is compared without case, because two
 * addresses that differ only in case are one address to the server.
 */
export function untitledName(taken: readonly string[]): string {
  const used = new Set(taken.map((entry) => entry.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const next = n === 1 ? UNTITLED : `${UNTITLED} ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** A blank page: one empty paragraph to type into. */
export function blankDocument(): string {
  return JSON.stringify(
    { type: "doc", content: [{ type: "paragraph" }] },
    null,
    2,
  );
}
