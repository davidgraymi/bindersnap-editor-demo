/**
 * Reading a Word file in the browser.
 *
 * A .docx is not opaque — it is XML in a ZIP, and the structure a reviewer
 * cares about (headings, paragraphs, lists, tables, emphasis) is right there
 * in it. Mammoth is the library that maps that onto semantic HTML, and it
 * runs entirely in the browser: no conversion service, no binary on the API
 * host, nothing uploaded anywhere to be rendered.
 *
 * It is imported on demand, so a reader who never opens a Word document never
 * downloads it.
 *
 * The deliberate limit: this reads `.docx` only. A legacy `.doc` is a binary
 * format from another era and no browser library reads it, so those keep the
 * honest "download it" card.
 */

/** The loaded library, kept so the second document in a comparison is instant. */
let mammoth: Promise<typeof import("mammoth")> | null = null;

async function loadMammoth() {
  if (mammoth === null) {
    mammoth = import("mammoth");
  }
  return mammoth;
}

/**
 * A Word file as HTML.
 *
 * Mammoth emits a small, semantic subset — headings, paragraphs, lists,
 * tables, `strong`, `em` — which is exactly what `sanitizeHtml` allows and
 * what htmldiff can compare.
 *
 * Images go. Mammoth inlines them as data URIs by default, and a comparison
 * is about the words: two base64 copies of a logo in every diff cost more
 * than the whole policy text and tell a reviewer nothing. Stripping them from
 * mammoth's own output is safe because that output is the only thing here
 * that produced a tag — and the result is sanitized before it reaches the DOM
 * regardless.
 */
export async function docxToHtml(file: Blob): Promise<string> {
  const lib = await loadMammoth();
  const bytes = await file.arrayBuffer();

  // Mammoth ships two readers and picks between them with package.json's
  // `browser` field: the browser one takes `arrayBuffer`, the Node one takes
  // `buffer`. The app always gets the browser build; the unit tests run under
  // Bun and get the other. Handing over both keys means one function works in
  // both places — each build reads the key it knows and ignores the other.
  const result = await lib.convertToHtml({
    arrayBuffer: bytes,
    buffer: new Uint8Array(bytes),
  } as Parameters<typeof lib.convertToHtml>[0]);

  return result.value.replace(/<img\b[^>]*>/gi, "");
}
