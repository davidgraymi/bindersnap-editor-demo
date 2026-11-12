/**
 * A comment on a passage: finding the words again.
 *
 * A reviewer selects words in a document and comments on them. A policy has
 * no line numbers, and the page it is drawn on is rebuilt whenever the
 * change is edited, so the comment remembers **the words themselves and a
 * few either side** — the way a person would point at them: "where it says
 * 'cheaper than standard', just after 'only where it was'".
 *
 * Everything here works on one string: the text of the document as it is
 * drawn, in order. `anchorFrom` cuts an anchor out of it; `locateAnchor`
 * finds it again. If the words are no longer there, it is not found, and
 * the page says the comment was made on wording that has since changed —
 * which is true, and worth knowing.
 */

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

/** Kept in step with the server's `ANCHOR_LIMITS`. */
export const QUOTE_LIMIT = 600;
export const CONTEXT_LENGTH = 40;

/**
 * The anchor for `text[start, end)`, trimmed of the spaces a dragged
 * selection picks up at its ends. Null for a selection of nothing.
 */
export function anchorFrom(
  text: string,
  start: number,
  end: number,
): (TextAnchor & { start: number; end: number }) | null {
  let from = Math.max(0, Math.min(start, end));
  let to = Math.min(text.length, Math.max(start, end));
  while (from < to && /\s/.test(text[from]!)) from += 1;
  while (to > from && /\s/.test(text[to - 1]!)) to -= 1;
  if (to <= from) return null;
  // A longer passage is a comment on the section: keep its opening words.
  if (to - from > QUOTE_LIMIT) to = from + QUOTE_LIMIT;
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: text.slice(to, to + CONTEXT_LENGTH),
    start: from,
    end: to,
  };
}

/** How many characters two strings share, counted back from their ends. */
function sharedEnd(a: string, b: string): number {
  let count = 0;
  while (
    count < a.length &&
    count < b.length &&
    a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/** …and counted forward from their starts. */
function sharedStart(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) {
    count += 1;
  }
  return count;
}

/**
 * Where the anchor's words are in `text`, or null when they are not there.
 *
 * A document may say the same words twice, so every place they appear is
 * scored by how much of the text either side still matches, and the best
 * wins; the first wins a tie.
 */
export function locateAnchor(
  text: string,
  anchor: TextAnchor,
): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  let best: { start: number; score: number } | null = null;
  let at = text.indexOf(anchor.quote);
  while (at !== -1) {
    const score =
      sharedEnd(
        text.slice(Math.max(0, at - anchor.prefix.length), at),
        anchor.prefix,
      ) + sharedStart(text.slice(at + anchor.quote.length), anchor.suffix);
    if (!best || score > best.score) best = { start: at, score };
    at = text.indexOf(anchor.quote, at + 1);
  }
  return best
    ? { start: best.start, end: best.start + anchor.quote.length }
    : null;
}

/** The passage as a line of a list shows it: its opening words. */
export function clampQuote(quote: string, limit = 140): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}
