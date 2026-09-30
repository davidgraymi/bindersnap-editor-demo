import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateAndSkewTextDegreesAndTranslate,
  setFillingColor,
  setFontAndSize,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import type { Run } from "./documentBlocks";
import { pictureSize, readPicture } from "./images";
import {
  SCREEN_FACES,
  faceForFamily,
  fontBytes,
  pickFile,
  type FaceKey,
} from "./fonts";

/**
 * A small page-layout engine: flowing, wrapped, styled text on Letter pages.
 *
 * `pdf-lib` draws text at coordinates and nothing more, so everything a reader
 * takes for granted — words wrapping, a heading never stranded at the foot of
 * a page, a table row kept whole — is done here. It is shared by the document
 * export and the audit packet, which is why it knows nothing about either.
 *
 * **Laid out the way a browser lays out the page.** A document's PDF has to be
 * the page its author saw, so lines are measured as CSS measures them: a
 * line box is the tallest of its pieces at their line-height, text sits on
 * the baseline the font's own ascent and descent put it at, and the space
 * between two blocks is the larger of their margins, not the sum.
 *
 * **Its bytes depend only on what is drawn.** Fonts are embedded under fixed
 * names and the metadata dates are fixed, so the same record makes the same
 * file — which matters for the audit packet, whose claim is that it can be
 * made again and compared. A character a font cannot draw is replaced, never
 * allowed to fail the export.
 */

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 72;
export const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type Rgb = [number, number, number];

const INK: Rgb = [0.11, 0.1, 0.09];
const MUTED = rgb(0.47, 0.44, 0.42);
const RULE: Rgb = [0.8, 0.78, 0.76];
const LINK: Rgb = [0.02, 0.39, 0.76];

/** The standard fonts, by the names the audit packet uses. */
export type Family = "serif" | "sans" | "mono";

const FAMILY_FACES: Record<Family, FaceKey> = {
  serif: "times",
  sans: "helvetica",
  mono: "courier",
};

export interface TextStyle {
  size: number;
  /** A standard font. `face` wins when both are given. */
  family?: Family;
  face?: FaceKey;
  /** What `code` is set in. Courier when unsaid. */
  codeFace?: FaceKey;
  /** 400 is regular. `bold` is 700. */
  weight?: number;
  bold?: boolean;
  italic?: boolean;
  color?: Rgb;
  linkColor?: Rgb;
  /** Behind inline `code`. None when unsaid. */
  codeFill?: Rgb;
  /** Space above, in points. The larger of it and the last block's wins. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** A multiple of the font size, as CSS's unitless line-height. */
  lineHeight?: number;
  indent?: number;
  /** Width to wrap in, from the indent. The text column when unsaid. */
  width?: number;
  align?: "left" | "center" | "right" | "justify";
  /** Drawn before the first line, ending where the text begins: "•", "3.". */
  marker?: string;
  /** A task list's box, drawn where a marker would be. */
  checkbox?: boolean;
  /** Keep this many following points on the same page — a heading's body. */
  keepWithNext?: number;
  /** Spaces kept as typed, as `white-space: pre-wrap` does. */
  preserveSpaces?: boolean;
}

interface Metrics {
  /** Above and below the baseline, as fractions of the size. */
  ascent: number;
  descent: number;
}

interface Piece {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
  run: Run;
  /** Raised or lowered, for superscript and subscript. */
  rise: number;
  slant: boolean;
  embolden: boolean;
  metrics: Metrics;
  /** Inline code's padding, either side. */
  pad: number;
  /** A space between words, which justification may widen. */
  gap: boolean;
}

export interface Line {
  pieces: Piece[];
  width: number;
  height: number;
  /** From the top of the line to its baseline. */
  baseline: number;
  /** Whether the paragraph ends here — the last line is never justified. */
  last: boolean;
}

/** Where the writer was: which page, and how far down it. */
export interface Mark {
  page: number;
  y: number;
}

export interface TableCellInput {
  runs?: Run[];
  /** A cell of several paragraphs, each set its own way. */
  paragraphs?: { runs: Run[]; style?: Partial<TextStyle> }[];
  header?: boolean;
  shade?: string | null;
  colspan?: number;
}

export function hexColor(value: string | undefined | null): Rgb | null {
  if (!value) return null;
  const match = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return [
    parseInt(match[1]!, 16) / 255,
    parseInt(match[2]!, 16) / 255,
    parseInt(match[3]!, 16) / 255,
  ];
}

/** What a font cannot draw is swapped for its nearest. */
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
  " ": " ",
  "​": "",
};

/**
 * What pdf-lib keeps of an embedded font: fontkit's font, which lays text out
 * with its kerning, and the subset the glyphs go into.
 */
interface CustomEmbedder {
  font: {
    unitsPerEm: number;
    layout(
      text: string,
      features?: unknown,
    ): {
      glyphs: { id: number; advanceWidth: number }[];
      positions: { xAdvance: number }[];
    };
  };
  fontFeatures?: unknown;
  subset?: { includeGlyph(glyph: unknown): number };
  glyphs?: unknown[];
  glyphIdMap?: Map<number, number>;
  glyphCache?: { invalidate(): void };
}

function customEmbedder(font: PDFFont): CustomEmbedder | null {
  const embedder = (font as unknown as { embedder: CustomEmbedder }).embedder;
  return embedder && typeof embedder.font?.layout === "function"
    ? embedder
    : null;
}

/**
 * `@pdf-lib/fontkit` copies each glyph into a subset byte for byte, then
 * writes the subset's glyph index in the short format — which stores every
 * offset halved. A font whose glyphs are not padded to an even length (Carlito
 * and EB Garamond; the long format allows it) then loses a byte at every odd
 * one, and the PDF draws garbage from there on. The TrueType spec says glyphs
 * should be padded; this pads them, once, for every subset.
 */
let subsetPadded = false;
function padSubsetGlyphs(sample: Uint8Array): void {
  if (subsetPadded) return;
  subsetPadded = true;
  const subset = (
    fontkit as unknown as {
      create(bytes: Uint8Array): { createSubset(): object };
    }
  )
    .create(sample)
    .createSubset();
  const proto = Object.getPrototypeOf(subset) as {
    _addGlyph(this: PaddedSubset, gid: number): unknown;
  };
  const addGlyph = proto._addGlyph;
  proto._addGlyph = function (this: PaddedSubset, gid: number) {
    const result = addGlyph.call(this, gid);
    const last = this.glyf.length - 1;
    const buffer = this.glyf[last]!;
    if (buffer.length % 2 === 1) {
      const Ctor = buffer.constructor as new (length: number) => Uint8Array;
      const padded = new Ctor(buffer.length + 1);
      for (let index = 0; index < buffer.length; index += 1)
        padded[index] = buffer[index]!;
      this.glyf[last] = padded;
      this.offset += 1;
    }
    return result;
  };
}

interface PaddedSubset {
  glyf: Uint8Array[];
  offset: number;
}

/** A list's bullets, which are drawn rather than set. */
const BULLET_SHAPES = new Set(["\u2022", "\u25e6", "\u25aa"]);

/** From a task's checkbox to its text: the box and the half-em after it. */
export const TASK_TEXT_OFFSET = 15.8;

/** Chromium's slant for a face with no italic, in degrees. */
const SLANT = 14;

/** CSS `font-weight: bolder`: what <strong> does to its parent's weight. */
export function bolder(weight: number): number {
  if (weight < 350) return 400;
  if (weight < 550) return 700;
  return 900;
}

export class PdfWriter {
  readonly doc: PDFDocument;
  private fonts = new Map<string, PDFFont>();
  private faces: FaceKey[] = [];
  private charsets = new Map<PDFFont, Set<number>>();
  private metricsCache = new Map<PDFFont, Metrics>();
  page!: PDFPage;
  y = 0;
  private pages: PDFPage[] = [];
  private images = new Map<Uint8Array, PDFImage>();
  /** The bottom margin of the last block, collapsed into the next one's top. */
  private pending = 0;

  private constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  static async create(meta: {
    title: string;
    subject?: string;
    /** The typefaces this document is set in. The standard three if unsaid. */
    faces?: FaceKey[];
  }): Promise<PdfWriter> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    padSubsetGlyphs(fontBytes("Geist-Regular.ttf"));
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
    writer.faces = [
      ...new Set(meta.faces ?? (["times", "helvetica", "courier"] as const)),
    ];
    for (const key of writer.faces) {
      for (const face of SCREEN_FACES[key]) {
        if (writer.fonts.has(face.file)) continue;
        const font = face.standard
          ? await doc.embedFont(face.file as StandardFonts)
          : await doc.embedFont(fontBytes(face.file), {
              subset: true,
              // Named, not suffixed at random, so the bytes are stable.
              customName: face.file.replace(/\.ttf$/, ""),
            });
        writer.fonts.set(face.file, font);
      }
    }
    writer.newPage();
    return writer;
  }

  /** The font the browser would draw this face, weight and style with. */
  resolve(
    face: FaceKey,
    weight: number,
    italic: boolean,
  ): { font: PDFFont; slant: boolean; embolden: boolean } {
    const key = this.faces.includes(face) ? face : this.faces[0]!;
    const pick = pickFile(SCREEN_FACES[key], weight, italic);
    return {
      font: this.fonts.get(pick.face.file)!,
      slant: pick.slant,
      embolden: pick.embolden,
    };
  }

  metrics(font: PDFFont): Metrics {
    let metrics = this.metricsCache.get(font);
    if (!metrics) {
      const ascent = font.heightAtSize(1000, { descender: false }) / 1000;
      const total = font.heightAtSize(1000) / 1000;
      metrics = { ascent, descent: Math.max(0, total - ascent) };
      this.metricsCache.set(font, metrics);
    }
    return metrics;
  }

  private charset(font: PDFFont): Set<number> {
    let set = this.charsets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.charsets.set(font, set);
    }
    return set;
  }

  /** Text `font` can draw. */
  clean(text: string, font?: PDFFont): string {
    const set = this.charset(
      font ?? this.resolve(this.faces[0]!, 400, false).font,
    );
    let out = "";
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (char === "\n" || char === "\t") out += " ";
      else if (set.has(code)) out += char;
      else if (char in SUBSTITUTES) out += SUBSTITUTES[char];
      else {
        const plain = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        out += [...plain].every((part) => set.has(part.codePointAt(0)!))
          ? plain
          : "?";
      }
    }
    return out;
  }

  /**
   * `forced` is a break the author asked for. CSS keeps the margin of the
   * block after one of those, and drops it after a page that simply filled.
   */
  newPage(forced = false): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
    this.pending = 0;
    this.keepTopMargin = forced;
  }

  private keepTopMargin = false;

  get atTop(): boolean {
    return this.y >= PAGE_HEIGHT - MARGIN - 0.5;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Start a new page unless `height` more points fit on this one. */
  ensure(height: number): void {
    if (this.y - height < MARGIN && !this.atTop) this.newPage();
  }

  space(points: number): void {
    const total = this.pending + points;
    this.pending = 0;
    if (this.atTop && !this.keepTopMargin) return;
    this.keepTopMargin = false;
    this.y -= total;
    if (this.y < MARGIN) this.newPage();
  }

  /**
   * Begin a block whose top margin is `top`: the gap above it is the larger
   * of that and the bottom margin of the block before, as CSS collapses them.
   */
  gap(top = 0): void {
    const gap = Math.max(this.pending, top);
    this.pending = 0;
    this.space(gap);
  }

  /** End a block whose bottom margin is `bottom`, to collapse with the next. */
  after(bottom: number): void {
    this.pending = Math.max(this.pending, bottom);
  }

  mark(): Mark {
    return { page: this.pages.indexOf(this.page), y: this.y };
  }

  /**
   * Draw something down the span from `from` to `to` — a quotation's rule —
   * once for each page it crosses.
   */
  decorate(
    from: Mark,
    to: Mark,
    draw: (page: PDFPage, top: number, bottom: number) => void,
  ): void {
    for (let index = from.page; index <= to.page; index += 1) {
      const top = index === from.page ? from.y : PAGE_HEIGHT - MARGIN;
      const bottom = index === to.page ? to.y : MARGIN;
      if (top > bottom) draw(this.pages[index]!, top, bottom);
    }
  }

  private baseFace(style: TextStyle): FaceKey {
    return style.face ?? FAMILY_FACES[style.family ?? "serif"];
  }

  private baseWeight(style: TextStyle): number {
    return style.weight ?? (style.bold ? 700 : 400);
  }

  /** Break runs into lines that fit `width`. */
  layout(runs: Run[], style: TextStyle, width: number): Line[] {
    const lineHeight = style.lineHeight ?? 1.35;
    const face = this.baseFace(style);
    const weight = this.baseWeight(style);
    // The paragraph's own font at its own size: the strut every line has,
    // even one whose text is all smaller.
    const strut = this.metrics(
      this.resolve(face, weight, Boolean(style.italic)).font,
    );
    const lines: Line[] = [];
    let current: Piece[] = [];
    let currentWidth = 0;

    const finish = (last: boolean) => {
      // Trailing spaces take no room at the end of a line.
      if (!style.preserveSpaces) {
        while (
          current.length > 0 &&
          current[current.length - 1]!.text.trim() === ""
        ) {
          currentWidth -= current.pop()!.width;
        }
      }
      let above = 0;
      let below = 0;
      const box = (size: number, metrics: Metrics, rise: number) => {
        const content = (metrics.ascent + metrics.descent) * size;
        const top = (size * lineHeight - content) / 2 + metrics.ascent * size;
        above = Math.max(above, top + rise);
        below = Math.max(below, size * lineHeight - top - rise);
      };
      box(style.size, strut, 0);
      for (const piece of current) box(piece.size, piece.metrics, piece.rise);
      lines.push({
        pieces: current,
        width: currentWidth,
        height: above + below,
        baseline: above,
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
      const runFace = run.code
        ? (style.codeFace ?? "courier")
        : (faceForFamily(run.font) ?? face);
      const runWeight = run.bold ? bolder(weight) : weight;
      const resolved = this.resolve(
        runFace,
        runWeight,
        Boolean(style.italic || run.italic),
      );
      const font = resolved.font;
      const metrics = this.metrics(font);
      let size = run.size ?? style.size;
      if (run.code) size *= 0.92;
      const parentSize = size;
      if (run.superscript || run.subscript) size /= 1.2;
      const rise = run.superscript
        ? parentSize / 3
        : run.subscript
          ? -parentSize / 5
          : 0;
      const pad = run.code && style.codeFill ? size * 0.2 : 0;
      const piece = (text: string, gap: boolean): Piece => ({
        text,
        font,
        size,
        width: this.measure(font, text, size) + pad * 2,
        run,
        rise,
        slant: resolved.slant,
        embolden: resolved.embolden,
        metrics,
        pad,
        gap,
      });
      // Words and the spaces between them, so a line breaks between words.
      // Only a real space: a no-break space holds its words together.
      const tokens = this.clean(run.text, font).split(/([ \t\n]+)/);
      for (const token of tokens) {
        if (token === "") continue;
        const isSpace = token.trim() === "" && !/ /.test(token);
        const text = isSpace && !style.preserveSpaces ? " " : token;
        if (isSpace && current.length === 0 && !style.preserveSpaces) continue;
        let next = piece(text, isSpace && !style.preserveSpaces);
        if (
          !isSpace &&
          currentWidth + next.width > width &&
          current.length > 0
        ) {
          finish(false);
        }
        // A word longer than the line is broken where it has to be.
        let rest = text;
        while (!isSpace && next.width > width && rest.length > 1) {
          let cut = rest.length - 1;
          while (cut > 1 && piece(rest.slice(0, cut), false).width > width)
            cut -= 1;
          const head = piece(rest.slice(0, cut), false);
          current.push(head);
          currentWidth += head.width;
          finish(false);
          rest = rest.slice(cut);
          next = piece(rest, false);
        }
        current.push(next);
        currentWidth += next.width;
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
    const base = style.color ?? INK;
    for (const line of lines) {
      const baseline = y - line.baseline;
      const gaps = line.pieces.filter((piece) => piece.gap).length;
      const justify = style.align === "justify" && !line.last && gaps > 0;
      const extra = justify ? (width - line.width) / gaps : 0;
      let cursor =
        style.align === "center"
          ? x + (width - line.width) / 2
          : style.align === "right"
            ? x + width - line.width
            : x;
      for (const piece of line.pieces) {
        const pieceWidth = piece.width + (piece.gap ? extra : 0);
        const { ascent, descent } = piece.metrics;
        const bottom = baseline + piece.rise - descent * piece.size;
        const height = (ascent + descent) * piece.size;
        const fill = piece.run.code
          ? style.codeFill
          : hexColor(piece.run.highlight);
        if (fill) {
          this.page.drawRectangle({
            x: cursor,
            y: bottom,
            width: pieceWidth,
            height,
            color: rgb(...fill),
          });
        }
        // A colour the author chose wins over a link's, as the span inside
        // the link does on screen.
        const color = rgb(
          ...(hexColor(piece.run.color) ??
            (piece.run.link ? (style.linkColor ?? LINK) : base)),
        );
        if (piece.text.trim() !== "") {
          const draw = (dx: number) =>
            this.show(piece.text, {
              x: cursor + piece.pad + dx,
              y: baseline + piece.rise,
              size: piece.size,
              font: piece.font,
              color,
              slant: piece.slant,
            });
          draw(0);
          // And its emboldening, for a weight the page has no file for.
          if (piece.embolden) draw(piece.size * 0.035);
        }
        const thickness = Math.max(0.5, piece.size * 0.06);
        if (piece.run.underline || piece.run.link) {
          const at = baseline + piece.rise - piece.size * 0.12;
          this.page.drawLine({
            start: { x: cursor, y: at },
            end: { x: cursor + pieceWidth, y: at },
            thickness,
            color,
          });
        }
        if (piece.run.strike) {
          const at = baseline + piece.rise + piece.size * 0.28;
          this.page.drawLine({
            start: { x: cursor, y: at },
            end: { x: cursor + pieceWidth, y: at },
            thickness,
            color,
          });
        }
        cursor += pieceWidth;
      }
      y -= line.height;
    }
    return top - y;
  }

  /**
   * How wide `text` is, kerned. pdf-lib adds up each glyph's own advance and
   * leaves out the font's kerning, which a browser applies — over a line of
   * Geist that is two per cent, and enough to break it in a different place.
   */
  measure(
    font: PDFFont,
    text: string,
    size: number,
    features?: string[],
  ): number {
    const embedder = customEmbedder(font);
    if (!embedder) return font.widthOfTextAtSize(text, size);
    const { positions } = embedder.font.layout(
      text,
      features ?? embedder.fontFeatures,
    );
    let units = 0;
    for (const position of positions) units += position.xAdvance;
    return (units * size) / embedder.font.unitsPerEm;
  }

  private fontKeys = new Map<PDFPage, Map<PDFFont, PDFName>>();

  private fontKey(font: PDFFont): PDFName {
    let keys = this.fontKeys.get(this.page);
    if (!keys) {
      keys = new Map();
      this.fontKeys.set(this.page, keys);
    }
    let key = keys.get(font);
    if (!key) {
      key = this.page.node.newFontDictionary(font.name, font.ref);
      keys.set(font, key);
    }
    return key;
  }

  /**
   * Draw `text` as `measure` measured it: each glyph placed where the font's
   * kerning puts it, in one TJ, so the words on paper are the words on screen.
   */
  private show(
    text: string,
    options: {
      x: number;
      y: number;
      size: number;
      font: PDFFont;
      color: Color;
      slant: boolean;
      features?: string[];
    },
  ): void {
    const { x, y, size, font, color, slant, features } = options;
    const embedder = customEmbedder(font);
    if (!embedder || !embedder.subset) {
      this.page.drawText(text, {
        x,
        y,
        size,
        font,
        color,
        ...(slant ? { ySkew: degrees(SLANT) } : {}),
      });
      return;
    }
    const { glyphs, positions } = embedder.font.layout(
      text,
      features ?? embedder.fontFeatures,
    );
    const scale = 1000 / embedder.font.unitsPerEm;
    const parts: (PDFHexString | PDFNumber)[] = [];
    glyphs.forEach((glyph, index) => {
      // Into the subset exactly as pdf-lib's own encodeText puts it, so the
      // font's text map still says what each glyph is.
      const id = embedder.subset!.includeGlyph(glyph);
      embedder.glyphs![id - 1] = glyph;
      embedder.glyphIdMap!.set(glyph.id, id);
      parts.push(
        PDFHexString.of(id.toString(16).toUpperCase().padStart(4, "0")),
      );
      const kern = positions[index]!.xAdvance - glyph.advanceWidth;
      if (kern !== 0) parts.push(PDFNumber.of(-kern * scale));
    });
    embedder.glyphCache!.invalidate();
    const array = PDFArray.withContext(this.doc.context);
    for (const part of parts) array.push(part);
    this.page.pushOperators(
      pushGraphicsState(),
      beginText(),
      setFillingColor(color),
      setFontAndSize(this.fontKey(font), size),
      rotateAndSkewTextDegreesAndTranslate(0, 0, slant ? SLANT : 0, x, y),
      PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [array]),
      endText(),
      popGraphicsState(),
    );
  }

  /** A paragraph of runs, flowing onto as many pages as it needs. */
  text(runs: Run[], style: TextStyle): void {
    const indent = style.indent ?? 0;
    const width = style.width ?? TEXT_WIDTH - indent;
    this.gap(style.spaceBefore ?? 0);
    const lines = this.layout(runs, style, width);
    const first = lines[0]!;
    this.ensure(first.height + (style.keepWithNext ?? 0));

    const x = MARGIN + indent;
    if (style.marker || style.checkbox !== undefined) {
      this.drawMarker(style, x, this.y, first);
    }

    for (const line of lines) {
      this.ensure(line.height);
      this.y -= this.drawLines([line], x, this.y, width, style);
    }
    this.after(style.spaceAfter ?? 0);
  }

  /**
   * A list's marker, where the browser puts an outside one: ending where the
   * text begins, on the first line's baseline, in the item's own font.
   */
  private drawMarker(style: TextStyle, x: number, top: number, line: Line) {
    const color = rgb(...(style.color ?? INK));
    const baseline = top - line.baseline;
    if (style.checkbox !== undefined) {
      // Chromium's own box, where it prints it: 13px square at the item's
      // left edge, sitting just below the baseline, in its blue.
      const side = 9.75;
      const left = x - TASK_TEXT_OFFSET + 0.5;
      const boxTop = baseline - 1.1 + side;
      if (style.checkbox) {
        this.page.drawRectangle({
          x: left,
          y: boxTop - side,
          width: side,
          height: side,
          color: rgb(0, 0.459, 1),
        });
        this.page.drawSvgPath("M 2.2 5 L 4.2 7 L 7.8 2.8", {
          x: left,
          y: boxTop,
          borderColor: rgb(1, 1, 1),
          borderWidth: 1.4,
        });
      } else {
        this.page.drawRectangle({
          x: left,
          y: boxTop - side,
          width: side,
          height: side,
          borderColor: rgb(0.46, 0.46, 0.46),
          borderWidth: 0.75,
          color: rgb(1, 1, 1),
        });
      }
      return;
    }
    const marker = style.marker!;
    const { font } = this.resolve(this.baseFace(style), 400, false);
    const size = style.size;
    if (!BULLET_SHAPES.has(marker)) {
      // "3." and the space after it, in tabular figures as ::marker sets
      // them, ending where the text begins.
      const width = this.measure(font, `${marker} `, size, ["tnum"]);
      this.show(marker, {
        x: x - width,
        y: baseline,
        size,
        font,
        color,
        slant: false,
        features: ["tnum"],
      });
      return;
    }
    // A disc, circle or square is a shape Chromium draws, not a character:
    // a third of an em across, most of an em before the text.
    const diameter = size * 0.36;
    const cx = x - size * 0.85;
    const cy = baseline + size * 0.26;
    if (marker === "▪") {
      this.page.drawRectangle({
        x: cx - diameter / 2,
        y: cy - diameter / 2,
        width: diameter,
        height: diameter,
        color,
      });
    } else {
      this.page.drawEllipse({
        x: cx,
        y: cy,
        xScale: diameter / 2,
        yScale: diameter / 2,
        ...(marker === "◦"
          ? { borderColor: color, borderWidth: 0.75 }
          : { color }),
      });
    }
  }

  /** Plain words in one style: the common case, without building runs. */
  say(text: string, style: TextStyle): void {
    this.text([{ text }], style);
  }

  rule(
    options: {
      spaceBefore?: number;
      spaceAfter?: number;
      color?: Rgb;
      thickness?: number;
      indent?: number;
    } = {},
  ): void {
    const thickness = options.thickness ?? 0.6;
    this.gap(options.spaceBefore ?? 6);
    this.ensure(thickness);
    this.page.drawLine({
      start: { x: MARGIN + (options.indent ?? 0), y: this.y - thickness / 2 },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y - thickness / 2 },
      thickness,
      color: rgb(...(options.color ?? RULE)),
    });
    this.y -= thickness;
    this.after(options.spaceAfter ?? 10);
  }

  /**
   * Preformatted text on a filled panel: every space kept, long lines
   * wrapped, and the panel drawn behind each page's share of it.
   */
  codeBlock(
    text: string,
    style: TextStyle & { fill: Rgb; padX: number; padY: number },
  ): void {
    const indent = style.indent ?? 0;
    const width = style.width ?? TEXT_WIDTH - indent;
    this.gap(style.spaceBefore ?? 0);
    const inner = width - style.padX * 2;
    const lines = text
      .split("\n")
      .flatMap((line) =>
        this.layout(
          [{ text: line }],
          { ...style, preserveSpaces: true },
          inner,
        ),
      );
    let index = 0;
    let first = true;
    while (index < lines.length) {
      this.ensure((first ? style.padY : 0) + lines[index]!.height);
      const top = this.y;
      let height = first ? style.padY : 0;
      let end = index;
      while (
        end < lines.length &&
        top - height - lines[end]!.height >= MARGIN - 0.5
      ) {
        height += lines[end]!.height;
        end += 1;
      }
      if (end === index) end += 1;
      const done = end >= lines.length;
      if (done) height += style.padY;
      this.page.drawRectangle({
        x: MARGIN + indent,
        y: top - height,
        width,
        height,
        color: rgb(...style.fill),
      });
      this.drawLines(
        lines.slice(index, end),
        MARGIN + indent + style.padX,
        top - (first ? style.padY : 0),
        inner,
        style,
      );
      this.y = top - height;
      index = end;
      first = false;
      if (!done) this.newPage();
    }
    this.after(style.spaceAfter ?? 0);
  }

  async picture(
    data: Uint8Array | null,
    authorWidth: number | null,
    alt: string,
    options: {
      indent?: number;
      align?: "left" | "center" | "right" | "justify";
      /** Below the picture's baseline: the line's descent, as on screen. */
      below?: number;
      spaceAfter?: number;
      placeholder?: TextStyle;
    } = {},
  ): Promise<void> {
    const info = data ? readPicture(data) : null;
    if (!data || !info || info.kind === "gif") {
      this.text([{ text: `[Picture${alt ? `: ${alt}` : ""}]`, italic: true }], {
        size: 10,
        color: [0.47, 0.44, 0.42],
        spaceAfter: options.spaceAfter ?? 6,
        ...options.placeholder,
      });
      return;
    }
    this.gap(0);
    let image = this.images.get(data);
    if (!image) {
      image =
        info.kind === "png"
          ? await this.doc.embedPng(data)
          : await this.doc.embedJpg(data);
      this.images.set(data, image);
    }
    const indent = options.indent ?? 0;
    const room = TEXT_WIDTH - indent;
    const size = pictureSize(info, authorWidth, room);
    const maxHeight = PAGE_HEIGHT - MARGIN * 2;
    const scale = size.height > maxHeight ? maxHeight / size.height : 1;
    const width = size.width * scale;
    const height = size.height * scale;
    const below = options.below ?? 0;
    this.ensure(height + below);
    const offset =
      options.align === "center"
        ? (room - width) / 2
        : options.align === "right"
          ? room - width
          : 0;
    this.y -= height;
    this.page.drawImage(image, {
      x: MARGIN + indent + offset,
      y: this.y,
      width,
      height,
    });
    this.y -= below;
    this.after(options.spaceAfter ?? 8);
  }

  /**
   * A table of cells, each laid out as runs or paragraphs; a row is never
   * split across pages, and a header row can be repeated at the top of the
   * next one.
   */
  table(
    rows: TableCellInput[][],
    options: {
      size?: number;
      family?: Family;
      face?: FaceKey;
      /** Each column's share of the table's width. Equal when unsaid. */
      widths?: number[];
      /** The table's width. The text column when unsaid. */
      width?: number;
      indent?: number;
      padX?: number;
      padY?: number;
      lineHeight?: number;
      color?: Rgb;
      borderColor?: Rgb;
      borderWidth?: number;
      headerFill?: Rgb;
      /** A header cell's weight. Bold when unsaid. */
      headerWeight?: number;
      repeatHeader?: boolean;
      spaceAfter?: number;
      /** Passed to every paragraph: what `code` is set in, links, fills. */
      text?: Partial<TextStyle>;
    } = {},
  ): void {
    const size = options.size ?? 10;
    const tableWidth = options.width ?? TEXT_WIDTH - (options.indent ?? 0);
    const left = MARGIN + (options.indent ?? 0);
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
    const padX = options.padX ?? 4;
    const padY = options.padY ?? 4;
    this.gap(0);

    const measure = (row: TableCellInput[]) => {
      let column = 0;
      return row.map((cell) => {
        const span = cell.colspan ?? 1;
        const width =
          fractions
            .slice(column, column + span)
            .reduce((sum, part) => sum + part, 0) * tableWidth;
        const x =
          left +
          fractions.slice(0, column).reduce((sum, part) => sum + part, 0) *
            tableWidth;
        column += span;
        const base: TextStyle = {
          size,
          family: options.family,
          face: options.face,
          lineHeight: options.lineHeight,
          color: options.color,
          ...options.text,
          weight: cell.header ? (options.headerWeight ?? 700) : 400,
        };
        const paragraphs = (cell.paragraphs ?? [{ runs: cell.runs ?? [] }]).map(
          (paragraph) => {
            const style: TextStyle = { ...base, ...paragraph.style };
            const lines = this.layout(paragraph.runs, style, width - padX * 2);
            return {
              lines,
              style,
              height: lines.reduce((sum, line) => sum + line.height, 0),
            };
          },
        );
        const height =
          paragraphs.reduce((sum, paragraph) => sum + paragraph.height, 0) +
          padY * 2;
        return { cell, width, x, paragraphs, height };
      });
    };

    const header =
      options.repeatHeader !== false && rows[0]?.every((cell) => cell.header)
        ? measure(rows[0]!)
        : null;
    const borderColor = rgb(...(options.borderColor ?? RULE));
    const drawRow = (laid: ReturnType<typeof measure>) => {
      const height = Math.max(...laid.map((entry) => entry.height));
      this.ensure(height);
      if (this.atTop && header && laid !== header) drawRow(header);
      for (const entry of laid) {
        const shade =
          hexColor(entry.cell.shade) ??
          (entry.cell.header
            ? (options.headerFill ?? [0.95, 0.94, 0.92])
            : null);
        this.page.drawRectangle({
          x: entry.x,
          y: this.y - height,
          width: entry.width,
          height,
          borderColor,
          borderWidth: options.borderWidth ?? 0.5,
          color: shade ? rgb(...shade) : undefined,
        });
        let top = this.y - padY;
        for (const paragraph of entry.paragraphs) {
          this.drawLines(
            paragraph.lines,
            entry.x + padX,
            top,
            entry.width - padX * 2,
            paragraph.style,
          );
          top -= paragraph.height;
        }
      }
      this.y -= height;
    };

    rows.forEach((row, index) =>
      drawRow(index === 0 && header ? header : measure(row)),
    );
    this.after(options.spaceAfter ?? 10);
  }

  /**
   * The audit packet's running header and "Page 3 of 7" footer. A document's
   * own PDF never has one: its pages carry what its author put on them.
   */
  furnish(running: string): void {
    const { font } = this.resolve("helvetica", 400, false);
    const text = this.clean(running, font);
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
