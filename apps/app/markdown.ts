/**
 * A deliberately small Markdown renderer for document previews.
 *
 * This is not a spec-complete parser and does not try to be. It covers what
 * shows up in the documents people put through an approval workflow —
 * headings, paragraphs, lists, quotes, tables, code, links, emphasis — and
 * leaves anything it does not recognise as plain text.
 *
 * Every character is HTML-escaped before any markup is emitted, so the output
 * contains only tags this module produced. Callers still pass the result
 * through `sanitizeHtml` before it reaches the DOM.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === "") return false;
  if (/^(#|\/|\.\/|\.\.\/)/.test(trimmed)) return true;
  return /^(https?:|mailto:)/i.test(trimmed);
}

/**
 * Marks where a code span was lifted out of the line. A control character is
 * used so nothing in a real document can collide with it, and `escapeHtml`
 * leaves it untouched.
 */
const PLACEHOLDER = "\u0001";

/** Inline spans: code, links, bold, italic, strikethrough. */
function renderInline(source: string): string {
  const codeSpans: string[] = [];

  // Pull code spans out first — their contents must not be re-formatted.
  const withPlaceholders = source.replace(/`([^`]+)`/g, (_match, code) => {
    codeSpans.push(`<code>${escapeHtml(String(code))}</code>`);
    return `${PLACEHOLDER}${codeSpans.length - 1}${PLACEHOLDER}`;
  });

  let html = escapeHtml(withPlaceholders);

  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, label: string, href: string) =>
      isSafeHref(href)
        ? `<a href="${href}" rel="noopener noreferrer">${label}</a>`
        : match,
  );

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return html.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"),
    (_match, index: string) => codeSpans[Number(index)] ?? "",
  );
}

function renderTableRow(line: string, cellTag: "td" | "th"): string {
  const cells = line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => `<${cellTag}>${renderInline(cell.trim())}</${cellTag}>`);
  return `<tr>${cells.join("")}</tr>`;
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";

    // Fenced code block
    const fence = line.match(/^\s*```/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      out.push("<hr />");
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
      index += 1;
      continue;
    }

    // Table: a header row followed by a divider row.
    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const rows = [renderTableRow(line, "th")];
      index += 2;
      while (
        index < lines.length &&
        (lines[index] ?? "").includes("|") &&
        (lines[index] ?? "").trim() !== ""
      ) {
        rows.push(renderTableRow(lines[index] ?? "", "td"));
        index += 1;
      }
      const [head, ...body] = rows;
      out.push(
        `<table><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`,
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*[-*+]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1]!)}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*\d+[.)]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1]!)}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      out.push(
        `<blockquote><p>${renderInline(quoted.join(" "))}</p></blockquote>`,
      );
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.trim() === "" ||
        /^\s*(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(current) ||
        /^\s*(?:[-*_]\s*){3,}$/.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}
