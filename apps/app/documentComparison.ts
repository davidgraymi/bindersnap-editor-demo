/**
 * What changed between the version on record and the one under review.
 *
 * Reviewers used to answer that by downloading both files and reading them
 * side by side on a desk. Everything the comparison screen says is decided
 * here — which version it compares against, what counts as an addition, and
 * the sentence that sums it up — so the answer can be checked without opening
 * a browser.
 */

import { diffWordsWithSpace } from "diff";
import htmldiff from "node-htmldiff";

import type { DocTag } from "./api";

/** One run of text, and whether this change put it there or took it away. */
export type DiffSegmentKind = "same" | "added" | "removed";

export interface DiffSegment {
  kind: DiffSegmentKind;
  value: string;
}

/**
 * The version this change is measured against, and what to call it on screen.
 *
 * A change proposes the next version, so the one it should be read against is
 * the one it replaces — not whatever `main` happens to point at now. For a
 * change that was already published as v4 that is v3, which is why this reads
 * the tag list rather than the branch.
 */
export interface ComparisonBase {
  /** The git ref to read the earlier file from. */
  ref: string;
  /** "v3", for the header above the left-hand side. */
  label: string;
}

export function resolveComparisonBase(params: {
  open: boolean;
  publishedVersion: number | null;
  tags: readonly DocTag[];
}): ComparisonBase | null {
  const { open, publishedVersion, tags } = params;
  const newestFirst = [...tags].sort(
    (left, right) => right.version - left.version,
  );

  // A published change replaced the version below the one it became. Reading
  // it against today's record would compare it with itself.
  if (!open && publishedVersion !== null) {
    const previous = newestFirst.find(
      (tag) => tag.version === publishedVersion - 1,
    );
    return previous
      ? { ref: previous.name, label: `v${previous.version}` }
      : null;
  }

  const latest = newestFirst[0];
  return latest ? { ref: latest.name, label: `v${latest.version}` } : null;
}

/**
 * Word-level differences between two pieces of plain text.
 *
 * Word level, not line level: a reviewer looking at a contract cares that
 * "thirty days" became "sixty days", and a whole line lit up red tells them
 * only that the line was touched.
 *
 * A run of pure whitespace is never marked. Re-exporting a document moves
 * line breaks around without changing a word of it, and a marked-up newline
 * is a coloured sliver with nothing in it — a strike through a line break
 * reads as a stray dash in the middle of a sentence nobody edited. Whitespace
 * the new version has is kept as-is; whitespace only the old one had goes.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];

  for (const part of diffWordsWithSpace(before, after)) {
    if (part.value === "") continue;

    const blank = part.value.trim() === "";
    if (blank && part.removed) continue;

    segments.push({
      kind:
        blank || (!part.added && !part.removed)
          ? "same"
          : part.added
            ? "added"
            : "removed",
      value: part.value,
    });
  }

  return segments;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** The line above the comparison: how much moved, in words. */
export interface ComparisonSummary {
  additions: number;
  deletions: number;
  identical: boolean;
  headline: string;
}

export function summarizeSegments(
  segments: readonly DiffSegment[],
): ComparisonSummary {
  let additions = 0;
  let deletions = 0;

  for (const segment of segments) {
    if (segment.kind === "added") additions += countWords(segment.value);
    if (segment.kind === "removed") deletions += countWords(segment.value);
  }

  const identical = additions === 0 && deletions === 0;

  return {
    additions,
    deletions,
    identical,
    headline: identical
      ? "Nothing changed — these two versions read the same."
      : [
          additions > 0
            ? `${additions} word${additions === 1 ? "" : "s"} added`
            : null,
          deletions > 0
            ? `${deletions} word${deletions === 1 ? "" : "s"} removed`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
  };
}

/**
 * The rendered comparison: two documents that have already been rendered to
 * HTML, diffed as markup.
 *
 * This is what makes the answer a readable policy with the change marked
 * inside it rather than two columns of source. Every caller renders its own
 * side first — our Markdown renderer, the PDF block renderer, or mammoth for
 * a Word file — and every one of those escapes what it was given. htmldiff
 * only ever adds `<ins>` and `<del>` around tokens it was handed. The caller
 * still passes the result through `sanitizeHtml` before it reaches the DOM.
 */
export function diffRenderedHtml(before: string, after: string): string {
  return htmldiff(before, after, "doc-compare-mark");
}
