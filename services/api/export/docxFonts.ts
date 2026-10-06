import { createHash } from "node:crypto";

import JSZip from "jszip";

import { DOCX_EMBEDS, fontBytes } from "./fonts";

/**
 * Put the fonts a Word document is set in inside it.
 *
 * Word has Calibri and Times New Roman; it does not have Geist or Lora, and
 * without them it sets the document in whatever it has instead. So the files go
 * in the .docx, as Word's own "Embed fonts in the file" puts them: obfuscated
 * (ECMA-376 Part 1, §17.8.1), listed in the font table, and marked in the
 * settings so Word keeps them when the document is saved again.
 *
 * `docx` embeds only a font's regular style, with a random key each time;
 * this embeds every style the page uses, keyed by the font file's own hash so
 * the same fonts always make the same bytes.
 */

const STYLES = ["regular", "bold", "italic", "boldItalic"] as const;
const ELEMENT = {
  regular: "w:embedRegular",
  bold: "w:embedBold",
  italic: "w:embedItalic",
  boldItalic: "w:embedBoldItalic",
} as const;

const FONT_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

/** A GUID from the file's hash: the same font, the same key. */
export function fontKey(bytes: Uint8Array): string {
  const hex = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** XOR the first 32 bytes with the key's bytes, last first. */
export function obfuscateFont(bytes: Uint8Array, key: string): Uint8Array {
  const hex = key.replace(/[-{}]/g, "");
  const keyBytes: number[] = [];
  for (let index = 30; index >= 0; index -= 2)
    keyBytes.push(parseInt(hex.slice(index, index + 2), 16));
  const out = new Uint8Array(bytes);
  for (let index = 0; index < 32 && index < out.length; index += 1)
    out[index] = out[index]! ^ keyBytes[index % 16]!;
  return out;
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Embed the named fonts, of those this module has files for. */
export async function embedFonts(
  docx: Uint8Array,
  names: Iterable<string>,
): Promise<Uint8Array> {
  const wanted = [...new Set(names)].filter((name) => DOCX_EMBEDS[name]);
  if (wanted.length === 0) return docx;
  const zip = await JSZip.loadAsync(docx);

  const fonts: string[] = [];
  const rels: string[] = [];
  let next = 1;
  for (const name of wanted) {
    const embeds: string[] = [];
    for (const style of STYLES) {
      const file = DOCX_EMBEDS[name]![style];
      if (!file) continue;
      const bytes = fontBytes(file);
      const key = fontKey(bytes);
      const id = `rIdFont${next}`;
      const target = `fonts/font${next}.odttf`;
      next += 1;
      zip.file(`word/${target}`, obfuscateFont(bytes, key));
      rels.push(
        `<Relationship Id="${id}" Type="${FONT_REL}" Target="${target}"/>`,
      );
      embeds.push(`<${ELEMENT[style]} r:id="${id}" w:fontKey="{${key}}"/>`);
    }
    fonts.push(
      `<w:font w:name="${escape(name)}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${embeds.join("")}</w:font>`,
    );
  }

  const tablePath = "word/fontTable.xml";
  const table = (await zip.file(tablePath)?.async("string")) ?? "";
  zip.file(
    tablePath,
    table.includes("</w:fonts>")
      ? table.replace("</w:fonts>", `${fonts.join("")}</w:fonts>`)
      : table.replace(
          /<w:fonts([^>]*)\/>/,
          `<w:fonts$1>${fonts.join("")}</w:fonts>`,
        ),
  );

  const relsPath = "word/_rels/fontTable.xml.rels";
  const existing =
    (await zip.file(relsPath)?.async("string")) ??
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(
    relsPath,
    existing.includes("</Relationships>")
      ? existing.replace("</Relationships>", `${rels.join("")}</Relationships>`)
      : existing.replace(
          /<Relationships([^>]*)\/>/,
          `<Relationships$1>${rels.join("")}</Relationships>`,
        ),
  );

  // Keep them when Word saves the file again. Its place in the settings is
  // fixed by the schema: after displayBackgroundShape.
  const settingsPath = "word/settings.xml";
  const settings = (await zip.file(settingsPath)?.async("string")) ?? "";
  if (settings && !settings.includes("w:embedTrueTypeFonts")) {
    zip.file(
      settingsPath,
      settings.includes("<w:displayBackgroundShape/>")
        ? settings.replace(
            "<w:displayBackgroundShape/>",
            "<w:displayBackgroundShape/><w:embedTrueTypeFonts/>",
          )
        : settings.replace(/(<w:settings[^>]*>)/, "$1<w:embedTrueTypeFonts/>"),
    );
  }

  return new Uint8Array(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}
