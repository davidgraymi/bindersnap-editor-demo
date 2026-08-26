import { expect, test } from "bun:test";

import type { DocTag } from "./api";
import { blocksToHtml, blocksToText } from "./documentBlocks";
import {
  diffRenderedHtml,
  diffWords,
  resolveComparisonBase,
  summarizeSegments,
} from "./documentComparison";
import { markdownToHtml } from "./markdown";

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

test("a PDF's headings survive as headings, not as run-on prose", () => {
  // The bug this replaced: every block joined with spaces, so a policy read
  // "Medication Administration Policy Purpose This policy sets out..." as one
  // sentence and the comparison marked it as one.
  const html = blocksToHtml([
    { kind: "heading", level: 1, text: "Medication Administration Policy" },
    { kind: "heading", level: 2, text: "Purpose" },
    { kind: "paragraph", level: 2, text: "This policy sets out how." },
  ]);

  expect(html).toBe(
    [
      "<h1>Medication Administration Policy</h1>",
      "<h2>Purpose</h2>",
      "<p>This policy sets out how.</p>",
    ].join("\n"),
  );
});

test("block text escapes whatever the document contained", () => {
  const html = blocksToHtml([
    { kind: "paragraph", level: 2, text: '<script>alert("x")</script>' },
  ]);

  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("blocksToText keeps the blocks apart so words do not run together", () => {
  const text = blocksToText([
    { kind: "heading", level: 2, text: "Scope" },
    { kind: "paragraph", level: 2, text: "This applies to everyone." },
  ]);

  expect(text).toBe("Scope\n\nThis applies to everyone.");
});

test("the Markdown comparison is a rendered document with the changes in it", () => {
  const html = diffRenderedHtml(
    markdownToHtml("# Vendor terms\n\nPayment is due within thirty days."),
    markdownToHtml("# Vendor terms\n\nPayment is due within sixty days."),
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
  const html = diffRenderedHtml(
    markdownToHtml("Nothing moved."),
    markdownToHtml("Nothing moved."),
  );
  expect(html).not.toContain("<ins");
  expect(html).not.toContain("<del");
});

test("a moved line break is not a change", () => {
  // Re-exporting a PDF or rewrapping a paragraph shifts whitespace without
  // touching a word. Marking it puts a coloured sliver with nothing in it
  // into the middle of a sentence nobody edited.
  const segments = diffWords(
    "Records and Retention\nRecords are kept for six years.",
    "Records and Retention\n\nRecords are kept for six years.",
  );

  expect(segments.every((segment) => segment.kind === "same")).toBe(true);
  // The new version's spacing is what survives, so the text still reads right.
  expect(segments.map((segment) => segment.value).join("")).toBe(
    "Records and Retention\n\nRecords are kept for six years.",
  );
  expect(summarizeSegments(segments).identical).toBe(true);
});

test("whitespace around a real edit is left unmarked", () => {
  const segments = diffWords("due within thirty days", "due within sixty days");
  const marked = segments.filter((segment) => segment.kind !== "same");

  expect(marked.every((segment) => segment.value.trim() !== "")).toBe(true);
});

test("a heading that was rewritten is marked inside the heading", () => {
  // The rendered comparison has to keep being a document: an edited heading
  // stays an <h2> with the change inside it, not a paragraph of diff output.
  const html = diffRenderedHtml(
    blocksToHtml([{ kind: "heading", level: 2, text: "Records" }]),
    blocksToHtml([
      { kind: "heading", level: 2, text: "Records and Retention" },
    ]),
  );

  expect(html).toContain("<h2>");
  expect(html).toContain("<ins");
  expect(html).toContain("Retention");
});
