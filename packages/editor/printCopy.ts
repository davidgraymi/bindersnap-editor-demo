/**
 * What the printer gets: the policy on Letter, with its name at the top of
 * every page and "Page 3 of 7" at the foot — Word's header and footer.
 *
 * **A copy, not the page on screen.** The page on screen lives inside the
 * app: a shell exactly the window's height with its overflow hidden, a file
 * panel, a navigation pane, a zoom. Hiding all that with `visibility` left
 * its boxes in place, and the printout was the policy squeezed into a column
 * on the right and cut off at the bottom of the first page. So while printing,
 * the document's HTML — the editor's own, without search highlights, the
 * selection or page marks — sits in a box of its own straight under
 * `<body>`, and every other child of `<body>` is not drawn at all.
 *
 * The header and footer are CSS page-margin boxes, which Chromium draws; a
 * browser that does not simply prints without them.
 */

const ROOT_CLASS = "bs-print-root";
const STYLE_ID = "bs-print-margins";
export const PRINTING_CLASS = "bs-printing-document";

/** A CSS string literal for `content:`, whatever the policy is called. */
export function cssString(text: string): string {
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")}"`;
}

export function pageMarginRules(title: string): string {
  return `@media print {
  @page {
    size: letter;
    margin: 1in;
    @top-left {
      content: ${cssString(title)};
      font: 9pt sans-serif;
      color: dimgray;
    }
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font: 9pt sans-serif;
      color: dimgray;
    }
  }
}`;
}

export function preparePrintCopy(html: string, title: string): void {
  removePrintCopy();

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  const page = document.createElement("div");
  page.className = "bs-doc-page";
  const content = document.createElement("div");
  content.className = "bs-doc-content";
  // The editor's own serialisation of the document it is holding.
  content.innerHTML = html;
  page.appendChild(content);
  root.appendChild(page);
  document.body.appendChild(root);

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = pageMarginRules(title);
  document.head.appendChild(style);

  document.documentElement.classList.add(PRINTING_CLASS);
}

export function removePrintCopy(): void {
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach((node) => node.remove());
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.classList.remove(PRINTING_CLASS);
}
