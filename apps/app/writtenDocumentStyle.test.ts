import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A document written in Bindersnap reads as it was written.
 *
 * The editor's page and the reader's page are two stylesheets, because the
 * editor's is loaded only with the editor. This holds them together: every
 * measure the reader sets for a written document is the editor's.
 */

const EDITOR = readFileSync(
  join(import.meta.dir, "../../packages/editor/assets/document-editor.css"),
  "utf8",
);
const APP = readFileSync(join(import.meta.dir, "app.css"), "utf8");

/** The measures that make a page look like itself. Colours are the theme's. */
const MEASURES = [
  "font-size",
  "line-height",
  "margin",
  "margin-bottom",
  "padding",
  "padding-left",
  "font-weight",
  "font-style",
  "table-layout",
  "vertical-align",
  "white-space",
  "overflow-wrap",
] as const;

/** Every declaration made for exactly this selector, later ones winning. */
function declarations(css: string, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(rule)) {
    const selectors = match[1]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((entry) => entry.replace(/\s+/g, " ").trim());
    if (!selectors.includes(selector)) continue;
    for (const line of match[2]!.split(";")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      found.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  return found;
}

const READER = ".doc-preview-prose.doc-preview-written";
const WRITER = ".bs-doc-content";

const ELEMENTS = [
  "",
  " p",
  " p.bs-title",
  " p.bs-subtitle",
  " h1",
  " h2",
  " h3",
  " h4",
  " ul",
  " li > p",
  " blockquote",
  " pre",
  " hr",
  " table",
  " td",
  " th",
  " td > p",
];

for (const element of ELEMENTS) {
  test(`the reader sets "${element.trim() || "the page"}" as the editor does`, () => {
    const writer = declarations(EDITOR, `${WRITER}${element}`);
    const reader = declarations(APP, `${READER}${element}`);
    expect(writer.size).toBeGreaterThan(0);
    for (const measure of MEASURES) {
      const written = writer.get(measure);
      if (written === undefined) continue;
      expect(`${measure}: ${reader.get(measure)}`).toBe(
        `${measure}: ${written}`,
      );
    }
  });
}
