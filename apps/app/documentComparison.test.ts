import { expect, test } from "bun:test";

import type { DocTag } from "./api";
import {
  diffRenderedMarkdown,
  diffWords,
  joinPdfPages,
  resolveComparisonBase,
  summarizeSegments,
} from "./documentComparison";

function tag(version: number): DocTag {
  return {
    name: `v${version}`,
    version,
    sha: `sha-${version}`,
    created: "2026-08-01T00:00:00Z",
  };
}

test("an open change is read against the version on record", () => {
  expect(
    resolveComparisonBase({
      open: true,
      publishedVersion: null,
      tags: [tag(3), tag(2), tag(1)],
    }),
  ).toEqual({ ref: "v3", label: "v3" });
});

test("a published change is read against the version it replaced", () => {
  // Comparing v4 with today's record would compare it with itself.
  expect(
    resolveComparisonBase({
      open: false,
      publishedVersion: 4,
      tags: [tag(4), tag(3), tag(2)],
    }),
  ).toEqual({ ref: "v3", label: "v3" });
});

test("the first version of a document has nothing to be compared against", () => {
  expect(
    resolveComparisonBase({ open: true, publishedVersion: null, tags: [] }),
  ).toBeNull();
  expect(
    resolveComparisonBase({
      open: false,
      publishedVersion: 1,
      tags: [tag(1)],
    }),
  ).toBeNull();
});

test("tag order in the payload does not decide the base", () => {
  expect(
    resolveComparisonBase({
      open: true,
      publishedVersion: null,
      tags: [tag(1), tag(3), tag(2)],
    }),
  ).toEqual({ ref: "v3", label: "v3" });
});

test("diffWords marks the words a change replaced, not the whole line", () => {
  const segments = diffWords(
    "Payment is due within thirty days.",
    "Payment is due within sixty days.",
  );

  expect(segments.filter((segment) => segment.kind === "removed")).toEqual([
    { kind: "removed", value: "thirty" },
  ]);
  expect(segments.filter((segment) => segment.kind === "added")).toEqual([
    { kind: "added", value: "sixty" },
  ]);
  // Everything else survives, so the sentence still reads as a sentence.
  expect(
    segments
      .filter((segment) => segment.kind === "same")
      .map((segment) => segment.value)
      .join(""),
  ).toBe("Payment is due within  days.");
});

test("diffWords reports nothing for two identical files", () => {
  const segments = diffWords("Same words.", "Same words.");
  expect(segments.every((segment) => segment.kind === "same")).toBe(true);
});

test("summarizeSegments counts words, not characters", () => {
  const summary = summarizeSegments(
    diffWords("The vendor shall notify us.", "The supplier must notify us."),
  );

  expect(summary.additions).toBe(2);
  expect(summary.deletions).toBe(2);
  expect(summary.identical).toBe(false);
  expect(summary.headline).toBe("2 words added · 2 words removed");
});

test("summarizeSegments says so plainly when nothing moved", () => {
  const summary = summarizeSegments(diffWords("Same words.", "Same words."));
  expect(summary.identical).toBe(true);
  expect(summary.headline).toBe(
    "Nothing changed — these two versions read the same.",
  );
});

test("summarizeSegments uses the singular for a one-word change", () => {
  const summary = summarizeSegments(
    diffWords("Due in days.", "Due in 30 days."),
  );
  expect(summary.headline).toBe("1 word added");
});

test("joinPdfPages flattens layout whitespace but keeps the page breaks", () => {
  expect(joinPdfPages(["  Section   one  ", "Section two"])).toBe(
    "Section one\n\nSection two",
  );
});

test("a PDF re-exported with different spacing does not read as a change", () => {
  const before = joinPdfPages(["Payment   is due  within thirty days."]);
  const after = joinPdfPages(["Payment is    due within thirty days."]);
  expect(summarizeSegments(diffWords(before, after)).identical).toBe(true);
});

test("the Markdown comparison is a rendered document with the changes in it", () => {
  const html = diffRenderedMarkdown(
    "# Vendor terms\n\nPayment is due within thirty days.",
    "# Vendor terms\n\nPayment is due within sixty days.",
  );

  // Still a document — the heading survives as a heading, not as diff output.
  expect(html).toContain("<h1>Vendor terms</h1>");
  expect(html).toContain(
    '<del data-operation-index="1" class="doc-compare-mark">thirty</del>',
  );
  expect(html).toContain(
    '<ins data-operation-index="1" class="doc-compare-mark">sixty</ins>',
  );
  expect(html).toContain("thirty");
  expect(html).toContain("sixty");
});

test("Markdown that did not change is rendered without any marks", () => {
  const html = diffRenderedMarkdown("Nothing moved.", "Nothing moved.");
  expect(html).not.toContain("<ins");
  expect(html).not.toContain("<del");
});
