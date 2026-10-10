import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The typefaces a document can be set in, and the files that draw them.
 *
 * **An export is set in the fonts the author saw.** The editor offers a short
 * list (`packages/editor/ribbon/options.ts`) and draws the page in Geist, with
 * headings in Lora. A PDF set in anything else is a different document, so
 * each choice here maps to a file that draws it:
 *
 * - Geist, Geist Mono and Lora are the app's own, loaded from Google Fonts in
 *   the browser; the same files are in `fonts/`.
 * - Calibri, Cambria, Georgia and Garamond cannot be shipped. Carlito,
 *   Caladea and Gelasio are drawn to their exact widths, so every line breaks
 *   where it did on screen; EB Garamond is the open Garamond.
 * - Arial, Helvetica, Times New Roman and Courier New are the PDF standard
 *   fonts, which every reader has and whose widths match.
 * - Verdana has no open equivalent drawn to its widths. Bitstream Vera is its
 *   nearest relation, and what a browser without Verdana shows.
 *
 * **Weights as the browser picks them.** The app loads Geist at 400–600, Geist
 * Mono at 400–500 and Lora at 500–700, so bold Geist on screen is 600 and
 * plain Lora is 500. `pickFile` follows the CSS font-matching rules over the
 * weights the page loads, so the PDF uses the same file the screen did.
 *
 * All of these are licensed to be embedded (the OFL, or Bitstream's licence
 * for Vera); the licences are beside the files.
 */

const FONT_DIR = join(import.meta.dir, "fonts");

export type FaceKey =
  | "geist"
  | "geistMono"
  | "lora"
  | "helvetica"
  | "times"
  | "courier"
  | "carlito"
  | "caladea"
  | "gelasio"
  | "ebGaramond"
  | "vera";

/** One of the 14 fonts every PDF reader has. */
export type StandardName =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique";

export interface FaceFile {
  weight: number;
  italic: boolean;
  /** A file in `fonts/`, or a standard font's name. */
  file: string;
  standard?: boolean;
}

const ribbi = (
  prefix: string,
  names = ["Regular", "Bold", "Italic", "BoldItalic"],
): FaceFile[] => [
  { weight: 400, italic: false, file: `${prefix}-${names[0]}.ttf` },
  { weight: 700, italic: false, file: `${prefix}-${names[1]}.ttf` },
  { weight: 400, italic: true, file: `${prefix}-${names[2]}.ttf` },
  { weight: 700, italic: true, file: `${prefix}-${names[3]}.ttf` },
];

const standard = (names: [string, string, string, string]): FaceFile[] =>
  ribbi("", names).map((face, index) => ({
    ...face,
    file: names[index]!,
    standard: true,
  }));

/** What the page draws with: the files at the weights the app loads. */
export const SCREEN_FACES: Record<FaceKey, FaceFile[]> = {
  geist: [
    { weight: 400, italic: false, file: "Geist-Regular.ttf" },
    { weight: 600, italic: false, file: "Geist-SemiBold.ttf" },
  ],
  geistMono: [
    { weight: 400, italic: false, file: "GeistMono-Regular.ttf" },
    { weight: 500, italic: false, file: "GeistMono-Medium.ttf" },
  ],
  lora: [
    { weight: 500, italic: false, file: "Lora-Medium.ttf" },
    { weight: 600, italic: false, file: "Lora-SemiBold.ttf" },
    { weight: 700, italic: false, file: "Lora-Bold.ttf" },
    { weight: 500, italic: true, file: "Lora-MediumItalic.ttf" },
    { weight: 600, italic: true, file: "Lora-SemiBoldItalic.ttf" },
  ],
  helvetica: standard([
    "Helvetica",
    "Helvetica-Bold",
    "Helvetica-Oblique",
    "Helvetica-BoldOblique",
  ]),
  times: standard([
    "Times-Roman",
    "Times-Bold",
    "Times-Italic",
    "Times-BoldItalic",
  ]),
  courier: standard([
    "Courier",
    "Courier-Bold",
    "Courier-Oblique",
    "Courier-BoldOblique",
  ]),
  carlito: ribbi("Carlito"),
  caladea: ribbi("Caladea"),
  gelasio: ribbi("Gelasio"),
  ebGaramond: ribbi("EBGaramond"),
  vera: ribbi("Vera", ["", "Bd", "It", "BI"]).map((face) => ({
    ...face,
    file: face.file.replace("-", ""),
  })),
};

/**
 * Which file the browser would draw `weight` and `italic` with, and what it
 * fakes: CSS Fonts 4, §5.2, over the faces the page has.
 *
 * An italic with no italic face is slanted; a weight of 600 or more drawn
 * with a face lighter than 600 is emboldened, as Chromium does.
 */
export function pickFile(
  faces: readonly FaceFile[],
  weight: number,
  italic: boolean,
): { face: FaceFile; slant: boolean; embolden: boolean } {
  const styled = faces.filter((face) => face.italic === italic);
  const pool = styled.length > 0 ? styled : faces.filter((f) => !f.italic);
  const weights = [...new Set(pool.map((face) => face.weight))].sort(
    (a, b) => a - b,
  );
  const below = weights.filter((w) => w < weight).reverse();
  const above = weights.filter((w) => w > weight);
  let order: number[];
  if (weights.includes(weight)) order = [weight];
  else if (weight >= 400 && weight <= 500) {
    order = [
      ...above.filter((w) => w <= 500),
      ...below,
      ...above.filter((w) => w > 500),
    ];
  } else if (weight < 400) order = [...below, ...above];
  else order = [...above, ...below];
  const chosen = order[0] ?? weights[0] ?? 400;
  const face = pool.find((entry) => entry.weight === chosen) ?? pool[0]!;
  return {
    face,
    slant: italic && !face.italic,
    embolden: weight >= 600 && face.weight < 600,
  };
}

const bytesCache = new Map<string, Uint8Array>();

export function fontBytes(file: string): Uint8Array {
  let bytes = bytesCache.get(file);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(join(FONT_DIR, file)));
    bytesCache.set(file, bytes);
  }
  return bytes;
}

/** The families in a CSS `font-family` value, unquoted and in order. */
export function familyNames(stack: string): string[] {
  return stack
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);
}

const BY_NAME: Record<string, FaceKey> = {
  "var(--brand-font-sans)": "geist",
  geist: "geist",
  "var(--brand-font-mono)": "geistMono",
  "geist mono": "geistMono",
  "var(--brand-font-serif)": "lora",
  lora: "lora",
  arial: "helvetica",
  "helvetica neue": "helvetica",
  helvetica: "helvetica",
  arimo: "helvetica",
  "liberation sans": "helvetica",
  calibri: "carlito",
  carlito: "carlito",
  cambria: "caladea",
  caladea: "caladea",
  georgia: "gelasio",
  gelasio: "gelasio",
  garamond: "ebGaramond",
  "eb garamond": "ebGaramond",
  "times new roman": "times",
  times: "times",
  tinos: "times",
  "liberation serif": "times",
  "courier new": "courier",
  courier: "courier",
  cousine: "courier",
  "liberation mono": "courier",
  verdana: "vera",
  geneva: "vera",
  "bitstream vera sans": "vera",
  "dejavu sans": "vera",
};

/** A browser's generic families, as Chromium resolves them. */
const GENERIC: Record<string, FaceKey> = {
  serif: "times",
  "sans-serif": "helvetica",
  monospace: "courier",
  "system-ui": "helvetica",
};

/**
 * The face a stored `font-family` draws with, or null for the document's own
 * (Geist). A name the list does not know falls through the stack as the
 * browser would, to a generic family at worst.
 */
export function faceForFamily(stack: string | undefined): FaceKey | null {
  if (!stack) return null;
  const names = familyNames(stack);
  for (const name of names) {
    const face = BY_NAME[name];
    if (face) return face;
  }
  for (const name of names) {
    const face = GENERIC[name];
    if (face) return face;
  }
  return null;
}

/**
 * The font a Word document names for a stored `font-family`.
 *
 * Word has Arial, Calibri, Cambria and the rest itself, so they are named as
 * the author chose them. The app's own faces are embedded (see `docxFonts`).
 */
export function wordFontForFamily(stack: string | undefined): string | null {
  if (!stack) return null;
  const [first] = familyNames(stack);
  if (!first) return null;
  const face = BY_NAME[first];
  if (face === "geist") return "Geist";
  if (face === "geistMono") return "Geist Mono";
  if (face === "lora") return "Lora";
  if (GENERIC[first]) {
    return {
      times: "Times New Roman",
      helvetica: "Arial",
      courier: "Courier New",
    }[GENERIC[first] as "times" | "helvetica" | "courier"];
  }
  // The name as the author picked it, capitalised the way Word lists it.
  const original = stack
    .split(",")[0]!
    .trim()
    .replace(/^["']|["']$/g, "");
  return original;
}

/**
 * The fonts a Word document embeds, because Word will not have them: each by
 * the name inside the file, which is the name Word matches it on.
 *
 * Word knows four styles of a family — regular, bold, italic, bold italic —
 * so Geist's and Lora's semibold, which the page uses for headings, are
 * families of their own ("Geist SemiBold"), as their files say they are.
 */
export const DOCX_EMBEDS: Record<
  string,
  Partial<Record<"regular" | "bold" | "italic" | "boldItalic", string>>
> = {
  Geist: { regular: "Geist-Regular.ttf", bold: "Geist-Bold.ttf" },
  "Geist SemiBold": { regular: "Geist-SemiBold.ttf" },
  "Geist Mono": {
    regular: "GeistMono-Regular.ttf",
    bold: "GeistMono-Bold.ttf",
  },
  Lora: {
    regular: "Lora-Regular.ttf",
    bold: "Lora-Bold.ttf",
    italic: "Lora-Italic.ttf",
    boldItalic: "Lora-BoldItalic.ttf",
  },
  "Lora SemiBold": {
    regular: "Lora-SemiBold.ttf",
    italic: "Lora-SemiBoldItalic.ttf",
  },
};
