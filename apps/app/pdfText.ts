/**
 * Reading a PDF back as a document, in the browser.
 *
 * A PDF renders fine in an iframe and tells you nothing about what changed, so
 * the comparison screen needs its words. pdf.js does that, and it is a large
 * library for something most readers never open — so it is imported on demand
 * and only the first PDF comparison in a session pays for it.
 *
 * What pdf.js hands back is glyph runs at coordinates, not prose: no
 * paragraphs, no headings, not even lines. Joining it all with spaces is what
 * ran a policy's title, its first heading and its opening sentence together
 * into one line. Everything below is the work of putting that structure back
 * from what the page actually carries — where each run sits, how tall it is,
 * and which face it was set in.
 */

import type { DocumentBlock } from "./documentBlocks";

/** The loaded library, kept so a second comparison is instant. */
let pdfjs: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null =
  null;

async function loadPdfjs() {
  if (pdfjs === null) {
    pdfjs = (async () => {
      const [lib, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      // pdf.js checks `globalThis.pdfjsWorker` before it goes looking for a
      // worker script to fetch. Handing it the module we just bundled keeps
      // the whole thing self-contained: no second asset, no worker URL to get
      // wrong in a subdirectory deploy. Parsing runs on the main thread, which
      // a one-off comparison can afford.
      (globalThis as Record<string, unknown>).pdfjsWorker = worker;
      return lib;
    })();
  }
  return pdfjs;
}

/** One run of glyphs, reduced to what deciding structure actually needs. */
interface TextRun {
  text: string;
  /** Distance up the page. Runs at the same y are on the same line. */
  y: number;
  /** Cap height of the face, which stands in for the point size. */
  size: number;
  fontName: string;
}

/** A line of the page: its runs joined, with the size they were set at. */
interface TextLine {
  text: string;
  y: number;
  size: number;
  fontName: string;
}

/**
 * Two runs are on the same line when their baselines are within this much.
 *
 * Subscripts, inline superscripts and the odd kerned run sit a point or two
 * off the baseline without starting a new line.
 */
const SAME_LINE_TOLERANCE = 3;

/**
 * A gap wider than this many times the line height starts a new block.
 *
 * Word sets paragraph spacing well above single leading, so the space between
 * two paragraphs is reliably larger than the space between two lines of one.
 */
const PARAGRAPH_GAP_RATIO = 1.45;

/** A heading has to be this much taller than the body to count as one. */
const HEADING_SIZE_RATIO = 1.08;

/** Beyond this many characters a line is prose, whatever it is set in. */
const MAX_HEADING_LENGTH = 120;

function groupIntoLines(runs: readonly TextRun[]): TextLine[] {
  const lines: TextLine[] = [];

  for (const run of runs) {
    if (run.text.trim() === "") continue;

    const open = lines[lines.length - 1];
    if (open && Math.abs(open.y - run.y) <= SAME_LINE_TOLERANCE) {
      // pdf.js emits a run per style change, and the space between two words
      // is often the gap between two runs rather than a character in either.
      open.text = `${open.text}${open.text.endsWith(" ") || run.text.startsWith(" ") ? "" : " "}${run.text}`;
      open.size = Math.max(open.size, run.size);
      continue;
    }

    lines.push({
      text: run.text,
      y: run.y,
      size: run.size,
      fontName: run.fontName,
    });
  }

  return lines.map((line) => ({ ...line, text: line.text.trim() }));
}

/**
 * The size most of the document is set in.
 *
 * The body size cannot be assumed — a policy exported at 10pt and one at 12pt
 * both have headings, and both have them *relative* to their own body. The
 * most-used size across the document is what that is.
 */
function bodySize(lines: readonly TextLine[]): number {
  const weight = new Map<number, number>();

  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2;
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }

  let winner = 0;
  let best = -1;
  for (const [size, chars] of weight) {
    if (chars > best) {
      best = chars;
      winner = size;
    }
  }

  return winner;
}

/**
 * Whether a line is a heading.
 *
 * Set larger than the body is the strong signal and the one that survives a
 * PDF from any writer. A short line in a face nobody else on the page uses is
 * the weaker one — it catches a bolded section heading set at body size,
 * which Word produces all the time — and it is deliberately gated on length
 * so a bolded sentence inside a paragraph is not promoted to a heading.
 */
function isHeading(
  line: TextLine,
  body: number,
  bodyFont: string | null,
): boolean {
  if (line.text.length > MAX_HEADING_LENGTH) return false;
  if (line.size >= body * HEADING_SIZE_RATIO) return true;
  return (
    bodyFont !== null && line.fontName !== bodyFont && line.text.length <= 60
  );
}

/** The face most of the document is set in, or null when it is all one. */
function bodyFontName(lines: readonly TextLine[], body: number): string | null {
  const weight = new Map<string, number>();

  for (const line of lines) {
    if (Math.round(line.size * 2) / 2 !== body) continue;
    weight.set(
      line.fontName,
      (weight.get(line.fontName) ?? 0) + line.text.length,
    );
  }

  let winner: string | null = null;
  let best = -1;
  for (const [font, chars] of weight) {
    if (chars > best) {
      best = chars;
      winner = font;
    }
  }

  return winner;
}

/**
 * Lines to blocks.
 *
 * A heading is always its own block. Consecutive body lines join into one
 * paragraph until the vertical gap between them opens up, which is what a
 * paragraph break physically is on a page.
 */
function groupIntoBlocks(lines: readonly TextLine[]): DocumentBlock[] {
  if (lines.length === 0) return [];

  const body = bodySize(lines);
  const bodyFont = bodyFontName(lines, body);
  const largest = Math.max(...lines.map((line) => line.size));
  const blocks: DocumentBlock[] = [];

  let previous: TextLine | null = null;

  for (const line of lines) {
    const heading = isHeading(line, body, bodyFont);
    const open = blocks[blocks.length - 1];

    // A page break is not a paragraph break: `y` restarts at the top of the
    // next page, so only a gap *down* the same page can be measured.
    const gap =
      previous && previous.y > line.y ? previous.y - line.y : Number.NaN;
    const breaks =
      heading ||
      open === undefined ||
      open.kind === "heading" ||
      Number.isNaN(gap) ||
      gap > line.size * PARAGRAPH_GAP_RATIO;

    if (breaks) {
      blocks.push({
        kind: heading ? "heading" : "paragraph",
        // The biggest thing on the page is the document's title; every other
        // heading is a section inside it.
        level: heading && line.size >= largest ? 1 : 2,
        text: line.text,
      });
    } else {
      open.text = `${open.text} ${line.text}`;
    }

    previous = line;
  }

  return blocks;
}

/**
 * A PDF read back as headings and paragraphs.
 *
 * Scanned PDFs have no text layer at all and come back empty; the caller says
 * so rather than reporting that nothing changed.
 */
export async function extractPdfBlocks(file: Blob): Promise<DocumentBlock[]> {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = lib.getDocument({
    data,
    // Only the words are wanted, so pdf.js is told not to install web fonts
    // it will never paint with.
    disableFontFace: true,
  });
  const document = await loading.promise;

  try {
    const lines: TextLine[] = [];

    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();

      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        runs.push({
          text: item.str,
          y: item.transform[5] ?? 0,
          // `height` is the transformed cap height, which tracks the point
          // size. `transform[3]` is the raw scale and misses a page that was
          // scaled as a whole.
          size: item.height || (item.transform[3] ?? 0),
          fontName: item.fontName ?? "",
        });
      }

      lines.push(...groupIntoLines(runs));
      page.cleanup();
    }

    return groupIntoBlocks(lines);
  } finally {
    // Frees the parsed document and, with it, the fake worker's state — a
    // reviewer flicking between changes should not accumulate PDFs in memory.
    await loading.destroy();
  }
}
