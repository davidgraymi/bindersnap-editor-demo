/**
 * A policy's table of contents, followed in the reader as it is in the editor.
 *
 * The editor jumps to a heading when its entry is clicked; the reader drew the
 * same list as plain paragraphs, so a forty-page manual's contents were a list
 * to read and then scroll for. The entries carry no link of their own — the
 * index the editor writes is a `data-` attribute, which the sanitizer strips —
 * and do not need one: the contents list the document's headings of levels
 * one to three, in order, so the nth entry is the nth such heading.
 */

const HEADINGS = "h1, h2, h3";

/** The heading a contents entry names, or null if the document has lost it. */
export function contentsTarget(entry: Element): Element | null {
  const contents = entry.closest(".bs-toc");
  const root = contents?.parentElement;
  if (!contents || !root) return null;
  const entries = [...contents.querySelectorAll(".bs-toc-entry")];
  const index = entries.indexOf(entry);
  if (index === -1) return null;
  const headings = [...root.querySelectorAll(HEADINGS)].filter(
    (heading) =>
      !heading.closest(".bs-toc") && (heading.textContent ?? "").trim() !== "",
  );
  return headings[index] ?? null;
}

/**
 * Make every contents entry under `root` a link to its heading: reachable by
 * Tab, followed by a click or Enter. Returns the undo, for when the document
 * is drawn again.
 */
export function wireContentsLinks(root: HTMLElement): () => void {
  const entries = [...root.querySelectorAll<HTMLElement>(".bs-toc-entry")];
  const follow = (entry: Element) => {
    const heading = contentsTarget(entry);
    if (!heading) return;
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const onClick = (event: MouseEvent) => {
    const entry = (event.target as Element | null)?.closest?.(".bs-toc-entry");
    if (entry && root.contains(entry)) follow(entry);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    const entry = (event.target as Element | null)?.closest?.(".bs-toc-entry");
    if (!entry || !root.contains(entry)) return;
    event.preventDefault();
    follow(entry);
  };
  for (const entry of entries) {
    if (!contentsTarget(entry)) continue;
    entry.setAttribute("role", "link");
    entry.setAttribute("tabindex", "0");
  }
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
  };
}
