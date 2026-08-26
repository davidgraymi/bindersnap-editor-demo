import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { htmlToText } from "./documentBlocks";

/**
 * Reading a fragment of HTML back as words.
 *
 * This feeds the comparison's word counts and never reaches the DOM — but the
 * first version stripped tags and decoded entities with a chain of regular
 * expressions, and CodeQL was right to flag it. A hand-rolled HTML reader is
 * one refactor away from being rendered by someone who assumed it was safe,
 * so the two failures that pattern always has are pinned here.
 */

let originalParser: unknown;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  originalParser = (globalThis as Record<string, unknown>).DOMParser;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: dom.window.DOMParser,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: originalParser,
  });
});

test("reads the words out of a document's markup", () => {
  expect(
    htmlToText("<h1>Records</h1><p>Kept for <strong>six</strong> years.</p>"),
  ).toBe("Records\n\nKept for six years.");
});

test("block elements keep the words on either side of them apart", () => {
  // Without a separator "years.Review" counts as one word and every heading
  // silently merges into the paragraph above it.
  expect(htmlToText("<p>six years.</p><h2>Review</h2>")).toBe(
    "six years.\n\nReview",
  );
});

test("a tag hidden inside another tag does not survive", () => {
  // The single-pass regex this replaced turned `<scr<script>ipt>` into
  // `<script>` — one substitution reassembling what it was meant to remove.
  const text = htmlToText("<p>Kept <scr<script>ipt>alert(1)</script> here</p>");

  expect(text).not.toContain("<script");
  expect(text).not.toContain("<");
});

test("an entity is decoded exactly once", () => {
  // `&amp;lt;` is the text "&lt;", not a less-than sign. Chained replacements
  // decoded the ampersand and then decoded the result again.
  expect(htmlToText("<p>&amp;lt;script&amp;gt;</p>")).toBe("&lt;script&gt;");
  expect(htmlToText("<p>Terms &amp; conditions</p>")).toBe(
    "Terms & conditions",
  );
});

test("layout whitespace collapses but the block breaks stay", () => {
  expect(htmlToText("<p>Due   within\n  thirty days</p><p>Signed</p>")).toBe(
    "Due within thirty days\n\nSigned",
  );
});
