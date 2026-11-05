/**
 * What a person typed, as a question for the index.
 *
 * Read the way ADR 0007 reads a query for every kind: split into words, every
 * word must match, case, accents and punctuation ignored. Each word is also a
 * prefix, because the box asks as the person types: "hyg" is on its way to
 * "hygiene", and finding nothing until the word is finished would be a box
 * that only answers people who type fast.
 */

import { SYNONYM_GROUPS } from "./synonyms";

/** More words than this is a sentence pasted in, not a search. */
const MAX_WORDS = 8;

/** The words of a piece of text, lower case and without accents. */
export function searchWords(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * Whether every word of the query begins a word of the text.
 *
 * For what the index cannot answer yet — a binder made since its last pass —
 * so those documents are matched on their titles the way indexed ones are.
 */
export function matchesSearchWords(
  text: string,
  query: readonly string[],
): boolean {
  const words = searchWords(text);
  return query.every((term) => words.some((word) => word.startsWith(term)));
}

/** Each group's ways of writing it, as words. */
const SYNONYMS = SYNONYM_GROUPS.map((group) => group.map(searchWords));

/**
 * The ways of writing what starts at `index`, and how many words it took —
 * the longest match, so "c diff" is read as one thing and not as "c".
 */
function synonymAt(
  words: readonly string[],
  index: number,
): { variants: string[][]; length: number } | null {
  let best: { variants: string[][]; length: number } | null = null;
  for (const variants of SYNONYMS) {
    for (const variant of variants) {
      const fits = variant.every(
        (word, offset) => words[index + offset] === word,
      );
      if (fits && variant.length > (best?.length ?? 0)) {
        best = { variants, length: variant.length };
      }
    }
  }
  return best;
}

/**
 * One word for FTS5. Quoted, so nothing typed is read as FTS5's own syntax —
 * the words are letters and digits only, so they hold no quote to escape. A
 * single letter is not a prefix: "c"* would match half the language.
 */
function term(word: string): string {
  return word.length >= 2 ? `"${word}"*` : `"${word}"`;
}

/**
 * The FTS5 query for what was typed, or null when it holds no word.
 *
 * `hand hyg` is `"hand"* AND "hyg"*`. A run of words in the synonym list is
 * every way of writing it, each as a phrase: `handwashing` is
 * `("hand hygiene" OR "handwashing" OR "hand washing")`.
 */
export function buildSearchQuery(raw: string): string | null {
  const words = searchWords(raw).slice(0, MAX_WORDS);
  if (words.length === 0) return null;

  const parts: string[] = [];
  for (let index = 0; index < words.length;) {
    const synonym = synonymAt(words, index);
    if (synonym) {
      parts.push(
        `(${synonym.variants.map((variant) => `"${variant.join(" ")}"`).join(" OR ")})`,
      );
      index += synonym.length;
    } else {
      parts.push(term(words[index]!));
      index += 1;
    }
  }
  return parts.join(" AND ");
}
