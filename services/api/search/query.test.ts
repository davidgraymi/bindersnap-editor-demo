import { describe, expect, test } from "bun:test";

import { buildSearchQuery, matchesSearchWords, searchWords } from "./query";

describe("buildSearchQuery", () => {
  test("every word must match, each as a prefix", () => {
    expect(buildSearchQuery("Hand hyg")).toBe('"hand"* AND "hyg"*');
  });

  test("case, accents and punctuation are ignored", () => {
    expect(buildSearchQuery("  Café, (naïve)!")).toBe('"cafe"* AND "naive"*');
  });

  test("FTS5's own syntax is never read from what was typed", () => {
    expect(buildSearchQuery('NEAR(a b) OR "x" -y *')).toBe(
      '"near"* AND "a" AND "b" AND "or"* AND "x" AND "y"',
    );
  });

  test("a word in the synonym list is every way of writing it", () => {
    expect(buildSearchQuery("handwashing")).toBe(
      '("hand hygiene" OR "handwashing" OR "hand washing")',
    );
    expect(buildSearchQuery("c. diff isolation")).toBe(
      '("c diff" OR "cdiff" OR "c difficile" OR "clostridioides difficile" OR "clostridium difficile") AND "isolation"*',
    );
  });

  test("nothing to search for is null", () => {
    expect(buildSearchQuery("  — ")).toBeNull();
  });
});

describe("matchesSearchWords", () => {
  test("each word of the query begins a word of the text", () => {
    const words = searchWords("hand hyg");
    expect(matchesSearchWords("hand-hygiene", words)).toBe(true);
    expect(matchesSearchWords("handover", words)).toBe(false);
  });
});
