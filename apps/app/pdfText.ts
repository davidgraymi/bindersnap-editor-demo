/**
 * Reading the words out of a PDF, in the browser.
 *
 * A PDF renders fine in an iframe and tells you nothing about what changed, so
 * the comparison screen needs its text. pdf.js does that, and it is a large
 * library for something most readers never open — so it is imported on demand
 * and only the first PDF comparison in a session pays for it.
 */

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

/**
 * The text of each page, in order.
 *
 * Scanned PDFs have no text layer at all and come back as empty pages; the
 * caller says so rather than reporting that nothing changed.
 */
export async function extractPdfPageText(file: Blob): Promise<string[]> {
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
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
      page.cleanup();
    }
    return pages;
  } finally {
    // Frees the parsed document and, with it, the fake worker's state — a
    // reviewer flicking between changes should not accumulate PDFs in memory.
    await loading.destroy();
  }
}
