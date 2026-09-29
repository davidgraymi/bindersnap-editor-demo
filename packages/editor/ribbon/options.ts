/**
 * What the ribbon's menus offer.
 *
 * **Fewer than Word, on purpose.** The old toolbar listed forty-three fonts,
 * most of which the reader's machine does not have — so a policy set in
 * "Bradley Hand" by its author was Times New Roman to everyone who approved
 * it. These are the faces that are either Bindersnap's own or on nearly every
 * computer, which is the only set where the author and the reviewer see the
 * same page.
 */

export interface FontChoice {
  label: string;
  /** The CSS stack stored on the text. Empty means the document's default. */
  value: string;
}

export const FONT_CHOICES: FontChoice[] = [
  { label: "Default (Geist)", value: "" },
  { label: "Lora", value: "var(--brand-font-serif)" },
  { label: "Arial", value: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { label: "Calibri", value: "Calibri, Carlito, Arial, sans-serif" },
  { label: "Cambria", value: "Cambria, Caladea, Georgia, serif" },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Garamond", value: 'Garamond, "EB Garamond", Georgia, serif' },
  { label: "Georgia", value: "Georgia, serif" },
  {
    label: "Helvetica",
    value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
];

/** Word's size list, in points, which is the unit people type into it. */
export const FONT_SIZES_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72,
] as const;

/** The size a paragraph has when nobody has set one. */
export const DEFAULT_FONT_SIZE_PT = 11;

/** The next size up or down Word's Grow and Shrink Font would pick. */
export function stepFontSize(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return FONT_SIZES_PT.find((size) => size > current) ?? current;
  }
  return [...FONT_SIZES_PT].reverse().find((size) => size < current) ?? current;
}

/** Points out of a stored size — `12pt`, or `16px` from older documents. */
export function parseFontSizePt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "px" ? Math.round(amount * 0.75 * 2) / 2 : amount;
}

export interface ColorChoice {
  label: string;
  value: string;
}

/**
 * Text colours. Stored in the document as they are, so they are literal —
 * a policy printed in five years has no design tokens to resolve — and chosen
 * to read on white paper, which is what the page is in both themes.
 */
export const TEXT_COLORS: ColorChoice[] = [
  { label: "Black", value: "#1c1917" },
  { label: "Dark gray", value: "#57534e" },
  { label: "Gray", value: "#a8a29e" },
  { label: "Dark red", value: "#b91c1c" },
  { label: "Coral", value: "#c84a0b" },
  { label: "Amber", value: "#b45309" },
  { label: "Green", value: "#15803d" },
  { label: "Teal", value: "#0f766e" },
  { label: "Blue", value: "#1d4ed8" },
  { label: "Navy", value: "#1e3a8a" },
  { label: "Purple", value: "#6d28d9" },
  { label: "Pink", value: "#be185d" },
];

/** Word's highlighter pens: light enough that black text reads through. */
export const HIGHLIGHT_COLORS: ColorChoice[] = [
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Turquoise", value: "#a5f3fc" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Orange", value: "#fed7aa" },
  { label: "Violet", value: "#ddd6fe" },
  { label: "Gray", value: "#e7e5e4" },
];

export type ParagraphStyleId =
  | "normal"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "quote"
  | "code";

export interface ParagraphStyle {
  id: ParagraphStyleId;
  label: string;
  /** Word's Ctrl+Alt shortcut for it, where there is one. */
  shortcut?: string;
}

/** Word's Styles gallery, as far as a policy needs one. */
export const PARAGRAPH_STYLES: ParagraphStyle[] = [
  { id: "normal", label: "Normal", shortcut: "Ctrl+Alt+0" },
  { id: "heading1", label: "Heading 1", shortcut: "Ctrl+Alt+1" },
  { id: "heading2", label: "Heading 2", shortcut: "Ctrl+Alt+2" },
  { id: "heading3", label: "Heading 3", shortcut: "Ctrl+Alt+3" },
  { id: "heading4", label: "Heading 4" },
  { id: "quote", label: "Quote" },
  { id: "code", label: "Code" },
];

/**
 * Symbols a policy actually needs and a keyboard does not have: section and
 * paragraph signs first, because "see § 4.2" is how policies refer to each
 * other.
 */
export const SYMBOLS: Array<{ char: string; name: string }> = [
  { char: "§", name: "Section sign" },
  { char: "¶", name: "Pilcrow" },
  { char: "—", name: "Em dash" },
  { char: "–", name: "En dash" },
  { char: "•", name: "Bullet" },
  { char: "…", name: "Ellipsis" },
  { char: "©", name: "Copyright" },
  { char: "®", name: "Registered" },
  { char: "™", name: "Trade mark" },
  { char: "°", name: "Degree" },
  { char: "±", name: "Plus-minus" },
  { char: "×", name: "Multiplication" },
  { char: "÷", name: "Division" },
  { char: "≤", name: "Less than or equal" },
  { char: "≥", name: "Greater than or equal" },
  { char: "≠", name: "Not equal" },
  { char: "€", name: "Euro" },
  { char: "£", name: "Pound" },
  { char: "¥", name: "Yen" },
  { char: "¢", name: "Cent" },
  { char: "✓", name: "Check mark" },
  { char: "✗", name: "Ballot X" },
  { char: "→", name: "Right arrow" },
  { char: "←", name: "Left arrow" },
];

/** How far the page can be zoomed, in percent — Word's own bounds are wider. */
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

/**
 * Today, in the ways a policy writes a date — Word's Insert > Date & Time.
 *
 * In the reader's own language, except the last: ISO is the one form that
 * reads the same on both sides of the Atlantic, which is what a date in a
 * record needs when "03/04" is March to one reader and April to another.
 * Written as text, not a field: a policy's effective date is the day it was
 * written, and must not move when it is opened a year later.
 */
export function dateChoices(now: Date, locale?: string): string[] {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(now);
  const iso = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const choices = [
    format({ day: "numeric", month: "long", year: "numeric" }),
    format({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    format({ day: "numeric", month: "short", year: "numeric" }),
    format({ month: "long", year: "numeric" }),
    iso,
  ];
  return [...new Set(choices)];
}
