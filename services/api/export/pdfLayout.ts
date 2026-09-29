import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import type { Run } from "./policyBlocks";
import { pictureSize, readPicture } from "./images";

/**
 * A small page-layout engine: flowing, wrapped, styled text on Letter pages.
 *
 * `pdf-lib` draws text at coordinates and nothing more, so everything a reader
 * takes for granted — words wrapping, a heading never stranded at the foot of
 * a page, a table row kept whole, "Page 3 of 7" — is done here. It is shared by
 * the policy export and the audit packet, which is why it knows nothing about
 * either.
 *
 * **The standard PDF fonts, deliberately.** Times and Helvetica are built into
 * every PDF reader, need no font files in the API image, and make a file whose
 * bytes depend only on its content — which matters for the audit packet, whose
 * whole claim is that it can be made again and compared. They cover Western
 * European text; a character they cannot draw is replaced, never allowed to
 * fail the export.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 72;
export const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.11, 0.1, 0.09);
const MUTED = rgb(0.47, 0.44, 0.42);
const RULE = rgb(0.8, 0.78, 0.76);
const LINK = rgb(0.02, 0.39, 0.76);

export type Family = "serif" | "sans" | "mono";

interface Fonts {
  serif: [PDFFont, PDFFont, PDFFont, PDFFont];
  sans: [PDFFont, PDFFont, PDFFont, PDFFont];
  mono: [PDFFont, PDFFont, PDFFont, PDFFont];
}

export interface TextStyle {
  size: number;
  family?: Family;
  bold?: boolean;
  italic?: boolean;
  color?: [number, number, number];
  /** Extra space above, in points. Collapsed at the top of a page. */
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
  indent?: number;
  /** Width to wrap in, from the indent. The text column when unsaid. */
  width?: number;
  align?: "left" | "center" | "right" | "justify";
  /** Drawn in the indent, on the first line: a bullet or "3.". */
  marker?: string;
  /** Keep this many following points on the same page — a heading's body. */
  keepWithNext?: number;
}

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
  run: Run;
  /** Raised or lowered, for superscript and subscript. */
  rise: number;
}

export interface Line {
  pieces: Piece[];
  width: number;
  height: number;
  /** Whether the paragraph ends here — the last line is never justified. */
  last: boolean;
}

function hexColor(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return rgb(
    parseInt(match[1]!, 16) / 255,
    parseInt(match[2]!, 16) / 255,
    parseInt(match[3]!, 16) / 255,
  );
}

/** What the standard fonts can draw; the rest is swapped for its nearest. */
const SUBSTITUTES: Record<string, string> = {
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "✓": "x",
  "✔": "x",
  "☐": "[ ]",
  "☑": "[x]",
  "☒": "[x]",
  "◦": "-",
  "▪": "-",
  " ": " ",
  " ": " ",
  "​": "",
};

export class PdfWriter {
  readonly doc: PDFDocument;
  private fonts!: Fonts;
  private charset!: Set<number>;
  page!: PDFPage;
  y = 0;
  private pages: PDFPage[] = [];
  private images = new Map<Uint8Array, PDFImage>();

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create(meta: {
    title: string;
    subject?: string;
  }): Promise<PdfWriter> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    // Fixed, so the same record makes the same bytes. The date a copy was
    // made is printed on it, where a reader can see it.
    const epoch = new Date(0);
    doc.setTitle(meta.title);
    if (meta.subject) doc.setSubject(meta.subject);
    doc.setProducer("Bindersnap");
    doc.setCreator("Bindersnap");
    doc.setCreationDate(epoch);
    doc.setModificationDate(epoch);

    const writer = new PdfWriter(doc);
    const embed = (name: StandardFonts) => doc.embedFont(name);
    writer.fonts = {
      serif: (await Promise.all([
        embed(StandardFonts.TimesRoman),
        embed(StandardFonts.TimesRomanBold),
        embed(StandardFonts.TimesRomanItalic),
        embed(StandardFonts.TimesRomanBoldItalic),
      ])) as Fonts["serif"],
      sans: (await Promise.all([
        embed(StandardFonts.Helvetica),
        embed(StandardFonts.HelveticaBold),
        embed(StandardFonts.HelveticaOblique),
        embed(StandardFonts.HelveticaBoldOblique),
      ])) as Fonts["sans"],
      mono: (await Promise.all([
        embed(StandardFonts.Courier),
        embed(StandardFonts.CourierBold),
        embed(StandardFonts.CourierOblique),
        embed(StandardFonts.CourierBoldOblique),
      ])) as Fonts["mono"],
    };
    writer.charset = new Set(writer.fonts.serif[0].getCharacterSet());
    writer.newPage();
    return writer;
  }

  private font(family: Family, bold: boolean, italic: boolean): PDFFont {
    return this.fonts[family][(bold ? 1 : 0) + (italic ? 2 : 0)]!;
  }

  /** Text the standard fonts can draw. */
  clean(text: string): string {
    let out = "";
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (char === "\n" || char === "\t") out += " ";
      else if (this.charset.has(code)) out += char;
      else if (char in SUBSTITUTES) out += SUBSTITUTES[char];
      else {
        const plain = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        out += [...plain].every((part) =>
          this.charset.has(part.codePointAt(0)!),
        )
          ? plain
          : "?";
      }
    }
    return out;
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  get atTop(): boolean {
    return this.y >= PAGE_HEIGHT - MARGIN - 0.5;
  }

  /** Start a new page unless `height` more points fit on this one. */
  ensure(height: number): void {
    if (this.y - height < MARGIN && !this.atTop) this.newPage();
  }

  space(points: number): void {
    if (this.atTop) return;
    this.y -= points;
    if (this.y < MARGIN) this.newPage();
  }

  /** Break runs into lines that fit `width`. */
  layout(runs: Run[], style: TextStyle, width: number): Line[] {
    const family = style.family ?? "serif";
    const lineHeight = style.lineHeight ?? 1.35;
    const lines: Line[] = [];
    let current: Piece[] = [];
    let currentWidth = 0;

    const finish = (last: boolean) => {
      // Trailing spaces take no room at the end of a line.
      while (
        current.length > 0 &&
        current[current.length - 1]!.text.trim() === ""
      ) {
        currentWidth -= current.pop()!.width;
      }
      const tallest = Math.max(
        style.size,
        ...current.map((piece) => piece.size),
      );
      lines.push({
        pieces: current,
        width: currentWidth,
        height: tallest * lineHeight,
        last,
      });
      current = [];
      currentWidth = 0;
    };

    for (const run of runs) {
      if (run.lineBreak) {
        finish(true);
        continue;
      }
      const small = run.superscript || run.subscript;
      const size = small ? style.size * 0.7 : style.size;
      const font = this.font(
        run.code ? "mono" : family,
        Boolean(style.bold || run.bold),
        Boolean(style.italic || run.italic),
      );
      const rise = run.superscript
        ? style.size * 0.33
        : run.subscript
          ? -style.size * 0.15
          : 0;
      // Words and the spaces between them, so a line breaks between words.
      for (const token of this.clean(run.text).split(/(\s+)/)) {
        if (token === "") continue;
        const isSpace = token.trim() === "";
        const text = isSpace ? " " : token;
        let tokenWidth = font.widthOfTextAtSize(text, size);
        if (isSpace && current.length === 0) continue;
        if (
          !isSpace &&
          currentWidth + tokenWidth > width &&
          current.length > 0
        ) {
          finish(false);
        }
        // A word longer than the line is broken where it has to be.
        let rest = text;
        while (!isSpace && tokenWidth > width) {
          let cut = rest.length - 1;
          while (
            cut > 1 &&
            font.widthOfTextAtSize(rest.slice(0, cut), size) > width
          )
            cut -= 1;
          const head = rest.slice(0, cut);
          current.push({
            text: head,
            font,
            size,
            width: font.widthOfTextAtSize(head, size),
            run,
            rise,
          });
          currentWidth += current[current.length - 1]!.width;
          finish(false);
          rest = rest.slice(cut);
          tokenWidth = font.widthOfTextAtSize(rest, size);
        }
        current.push({ text: rest, font, size, width: tokenWidth, run, rise });
        currentWidth += tokenWidth;
      }
    }
    if (current.length > 0 || lines.length === 0) finish(true);
    else if (lines.length > 0) lines[lines.length - 1]!.last = true;
    return lines;
  }

  /** Draw laid-out lines from the top-left corner (x, y), on this page. */
  drawLines(
    lines: Line[],
    x: number,
    top: number,
    width: number,
    style: TextStyle,
  ): number {
    let y = top;
    const base = style.color ? rgb(...style.color) : INK;
    for (const line of lines) {
      y -= line.height;
      const baseline = y + (line.height - style.size) / 2 + style.size * 0.22;
      const gaps = line.pieces.filter((piece) => piece.text === " ").length;
      const justify = style.align === "justify" && !line.last && gaps > 0;
      const extra = justify ? (width - line.width) / gaps : 0;
      let cursor =
        style.align === "center"
          ? x + (width - line.width) / 2
          : style.align === "right"
            ? x + width - line.width
            : x;
      for (const piece of line.pieces) {
        const pieceWidth = piece.width + (piece.text === " " ? extra : 0);
        const highlight = hexColor(piece.run.highlight);
        if (highlight) {
          this.page.drawRectangle({
            x: cursor,
            y: baseline - piece.size * 0.22,
            width: pieceWidth,
            height: piece.size * 1.1,
            color: highlight,
          });
        }
        const color = piece.run.link
          ? LINK
          : (hexColor(piece.run.color) ?? base);
        if (piece.text !== " ") {
          this.page.drawText(piece.text, {
            x: cursor,
            y: baseline + piece.rise,
            size: piece.size,
            font: piece.font,
            color,
          });
        }
        if (piece.run.underline || piece.run.link) {
          this.page.drawLine({
            start: { x: cursor, y: baseline - 1.5 },
            end: { x: cursor + pieceWidth, y: baseline - 1.5 },
            thickness: 0.5,
            color,
          });
        }
        if (piece.run.strike) {
          this.page.drawLine({
            start: { x: cursor, y: baseline + piece.size * 0.3 },
            end: { x: cursor + pieceWidth, y: baseline + piece.size * 0.3 },
            thickness: 0.6,
            color,
          });
        }
        cursor += pieceWidth;
      }
    }
    return top - y;
  }

  /** A paragraph of runs, flowing onto as many pages as it needs. */
  text(runs: Run[], style: TextStyle): void {
    const indent = style.indent ?? 0;
    const width = style.width ?? TEXT_WIDTH - indent;
    if (style.spaceBefore) this.space(style.spaceBefore);
    const lines = this.layout(runs, style, width);
    const first = lines[0]?.height ?? style.size;
    this.ensure(first + (style.keepWithNext ?? 0));

    if (style.marker) {
      const font = this.font(style.family ?? "serif", false, false);
      const marker = this.clean(style.marker);
      const markerWidth = font.widthOfTextAtSize(marker, style.size);
      this.page.drawText(marker, {
        x: MARGIN + indent - markerWidth - 6,
        y: this.y - first + (first - style.size) / 2 + style.size * 0.22,
        size: style.size,
        font,
        color: style.color ? rgb(...style.color) : INK,
      });
    }

    for (const line of lines) {
      this.ensure(line.height);
      this.y -= this.drawLines([line], MARGIN + indent, this.y, width, style);
    }
    if (style.spaceAfter) this.space(style.spaceAfter);
  }

  /** Plain words in one style: the common case, without building runs. */
  say(text: string, style: TextStyle): void {
    this.text([{ text }], style);
  }

  rule(options: { spaceBefore?: number; spaceAfter?: number } = {}): void {
    this.space(options.spaceBefore ?? 6);
    this.ensure(2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.space(options.spaceAfter ?? 10);
  }

  async picture(
    data: Uint8Array | null,
    authorWidth: number | null,
    alt: string,
  ): Promise<void> {
    const info = data ? readPicture(data) : null;
    if (!data || !info || info.kind === "gif") {
      this.text([{ text: `[Picture${alt ? `: ${alt}` : ""}]`, italic: true }], {
        size: 10,
        color: [0.47, 0.44, 0.42],
        spaceAfter: 6,
      });
      return;
    }
    let image = this.images.get(data);
    if (!image) {
      image =
        info.kind === "png"
          ? await this.doc.embedPng(data)
          : await this.doc.embedJpg(data);
      this.images.set(data, image);
    }
    const size = pictureSize(info, authorWidth, TEXT_WIDTH);
    const maxHeight = PAGE_HEIGHT - MARGIN * 2;
    const scale = size.height > maxHeight ? maxHeight / size.height : 1;
    const width = size.width * scale;
    const height = size.height * scale;
    this.ensure(height);
    this.y -= height;
    this.page.drawImage(image, { x: MARGIN, y: this.y, width, height });
    this.space(8);
  }

  /**
   * A table of cells, each laid out as runs; a row is never split across
   * pages, and a header row is repeated at the top of the next one.
   */
  table(
    rows: {
      runs: Run[];
      header?: boolean;
      shade?: string | null;
      colspan?: number;
    }[][],
    options: { size?: number; family?: Family; widths?: number[] } = {},
  ): void {
    const size = options.size ?? 10;
    const family = options.family ?? "serif";
    const columns =
      options.widths?.length ??
      Math.max(
        1,
        ...rows.map((row) =>
          row.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0),
        ),
      );
    const fractions =
      options.widths ?? Array.from({ length: columns }, () => 1 / columns);
    const padding = 4;

    const measure = (row: (typeof rows)[number]) => {
      let column = 0;
      return row.map((cell) => {
        const span = cell.colspan ?? 1;
        const width =
          fractions
            .slice(column, column + span)
            .reduce((sum, part) => sum + part, 0) * TEXT_WIDTH;
        const x =
          MARGIN +
          fractions.slice(0, column).reduce((sum, part) => sum + part, 0) *
            TEXT_WIDTH;
        column += span;
        const style: TextStyle = { size, family, bold: cell.header };
        const lines = this.layout(cell.runs, style, width - padding * 2);
        const height =
          lines.reduce((sum, line) => sum + line.height, 0) + padding * 2;
        return { cell, width, x, lines, height, style };
      });
    };

    const header = rows[0]?.every((cell) => cell.header)
      ? measure(rows[0]!)
      : null;
    const drawRow = (laid: ReturnType<typeof measure>) => {
      const height = Math.max(...laid.map((entry) => entry.height));
      this.ensure(height);
      if (this.atTop && header && laid !== header) drawRow(header);
      for (const entry of laid) {
        const shade = hexColor(entry.cell.shade ?? undefined);
        this.page.drawRectangle({
          x: entry.x,
          y: this.y - height,
          width: entry.width,
          height,
          borderColor: RULE,
          borderWidth: 0.5,
          color:
            shade ?? (entry.cell.header ? rgb(0.95, 0.94, 0.92) : undefined),
        });
        this.drawLines(
          entry.lines,
          entry.x + padding,
          this.y - padding,
          entry.width - padding * 2,
          entry.style,
        );
      }
      this.y -= height;
    };

    rows.forEach((row, index) =>
      drawRow(index === 0 && header ? header : measure(row)),
    );
    this.space(10);
  }

  /** "Title · status" at the top and "Page 3 of 7" at the foot of every page. */
  furnish(running: string): void {
    const font = this.fonts.sans[0];
    const text = this.clean(running);
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      page.drawText(text, {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN / 2,
        size: 8,
        font,
        color: MUTED,
      });
      const label = `Page ${index + 1} of ${total}`;
      page.drawText(label, {
        x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(label, 8),
        y: MARGIN / 2,
        size: 8,
        font,
        color: MUTED,
      });
    });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: false });
  }
}
