import createDOMPurify from "dompurify";
import type { JSONContent } from "@tiptap/core";

export type ProseMirrorJSON = JSONContent;

const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "strong",
  "em",
  "u",
  "s",
  // The change comparison marks what a version added and removed. Both are
  // plain semantic HTML with no behaviour of their own.
  "ins",
  "del",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
  // What the editor formats with — a coloured or resized run is a span, a
  // highlight is a mark, a page break is a div. Without them a reader saw a
  // policy with its emphasis stripped out that its author never wrote.
  "span",
  "mark",
  "sub",
  "sup",
  "hr",
  "br",
  "div",
  "colgroup",
  "col",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "class",
  "type",
  "checked",
  "colspan",
  "rowspan",
  "rel",
  // A picture's size, in whole pixels only — see the hook below.
  "width",
  // Filtered to a handful of typographic properties by `safeStyle` below.
  "style",
];

const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
  "text",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "taskList",
  "taskItem",
  "pageBreak",
  "tableOfContents",
  "conflict",
]);

const ALLOWED_MARK_TYPES = new Set([
  "bold",
  "italic",
  "strike",
  "underline",
  "code",
  "link",
  "subscript",
  "superscript",
  "highlight",
  "textStyle",
  "insertion",
  "deletion",
  "formatChange",
]);

const EMBEDDED_FRAGMENT_ATTRS = new Set([
  "ourContent",
  "theirContent",
  "baseContent",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenScheme(value: string): boolean {
  return /^\s*(?:javascript|vbscript|data):/i.test(value);
}

/**
 * A picture embedded in a document by the editor: raster kinds only, base64.
 * SVG stays out, because an SVG can carry script.
 */
const EMBEDDED_PICTURE =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSafeImageSrc(value: string): boolean {
  return EMBEDDED_PICTURE.test(value.trim()) || isSafeUrl(value);
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return false;
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("?")
  ) {
    return true;
  }

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z\d+.-]*:)/);
  if (!schemeMatch) {
    return true;
  }

  return !hasForbiddenScheme(trimmed);
}

function sanitizeMarks(marks: unknown): JSONContent["marks"] | undefined {
  if (!Array.isArray(marks)) {
    return undefined;
  }

  const sanitizedMarks: NonNullable<JSONContent["marks"]> = [];

  for (const mark of marks) {
    if (!isPlainObject(mark)) {
      continue;
    }

    const markType = mark.type;
    if (typeof markType !== "string" || !ALLOWED_MARK_TYPES.has(markType)) {
      continue;
    }

    if (markType === "link") {
      const attrs: Record<string, unknown> = isPlainObject(mark.attrs)
        ? { ...mark.attrs }
        : {};
      const href = attrs.href;

      if (typeof href !== "string" || !isSafeUrl(href)) {
        continue;
      }

      attrs.rel = "noopener noreferrer";
      sanitizedMarks.push({ type: markType, attrs });
      continue;
    }

    const sanitizedMark: Record<string, unknown> = { type: markType };
    if (isPlainObject(mark.attrs)) {
      sanitizedMark.attrs = { ...mark.attrs };
    }

    sanitizedMarks.push(
      sanitizedMark as NonNullable<JSONContent["marks"]>[number],
    );
  }

  return sanitizedMarks.length > 0 ? sanitizedMarks : undefined;
}

function sanitizeNodeOrFragment(value: unknown): JSONContent[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => sanitizeNodeOrFragment(item));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const nodeType = value.type;
  if (typeof nodeType !== "string") {
    if (Array.isArray(value.content)) {
      return sanitizeNodeOrFragment(value.content);
    }
    return [];
  }

  if (!ALLOWED_NODE_TYPES.has(nodeType)) {
    if (Array.isArray(value.content)) {
      return sanitizeNodeOrFragment(value.content);
    }
    return [];
  }

  const sanitizedNode: Record<string, unknown> = { type: nodeType };

  if (nodeType === "text") {
    sanitizedNode.text = typeof value.text === "string" ? value.text : "";
    const marks = sanitizeMarks(value.marks);
    if (marks) {
      sanitizedNode.marks = marks;
    }
    return [sanitizedNode as JSONContent];
  }

  if (nodeType === "image") {
    const attrs: Record<string, unknown> = isPlainObject(value.attrs)
      ? { ...value.attrs }
      : {};
    if (typeof attrs.src !== "string" || !isSafeImageSrc(attrs.src)) {
      return [];
    }
    sanitizedNode.attrs = attrs;
  } else if (isPlainObject(value.attrs)) {
    const attrs: Record<string, unknown> = { ...value.attrs };

    if (nodeType === "conflict") {
      for (const key of EMBEDDED_FRAGMENT_ATTRS) {
        if (key in attrs) {
          attrs[key] = sanitizeNodeOrFragment(attrs[key]);
        }
      }
    }

    sanitizedNode.attrs = attrs;
  }

  if (Array.isArray(value.content)) {
    const content = value.content.flatMap((item) =>
      sanitizeNodeOrFragment(item),
    );
    sanitizedNode.content = content;
  } else if (nodeType === "doc") {
    sanitizedNode.content = [];
  }

  const marks = sanitizeMarks(value.marks);
  if (marks) {
    sanitizedNode.marks = marks;
  }

  return [sanitizedNode as JSONContent];
}

/**
 * The inline style properties a document may carry, and the shape each value
 * has to have.
 *
 * **An allowlist of values, not only of names.** `style` is how the editor
 * writes a colour, a font, a size, an alignment, a line spacing and an indent,
 * so dropping it wholesale showed readers a policy without the emphasis its
 * author gave it. But a style attribute is also where `url(...)` and
 * `expression(...)` live, so each property keeps only a value that could not
 * be anything but typography: a colour, a length, a number, a keyword, or a
 * font name.
 */
const SAFE_STYLE_VALUES: Record<string, RegExp> = {
  color: /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|var\(--[\w-]+\)|[a-z]+)$/i,
  "background-color":
    /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|var\(--[\w-]+\)|[a-z]+)$/i,
  "font-size": /^\d+(\.\d+)?(px|pt|em|rem|%)$/,
  "font-family": /^[\w\s,"'-]+$|^var\(--[\w-]+\)$/,
  "text-align": /^(left|right|center|justify)$/,
  "line-height": /^\d+(\.\d+)?$/,
  "margin-left": /^\d+(\.\d+)?(in|px|pt|em|rem)$/,
  width: /^\d+(\.\d+)?(px|%)$/,
  "min-width": /^\d+(\.\d+)?px$/,
};

/** The declarations of a style attribute that are typography, re-serialized. */
export function safeStyle(style: string): string {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const shape = SAFE_STYLE_VALUES[property];
    if (!shape || value === "" || value.length > 200) continue;
    if (/[\\<>]|url\s*\(|expression\s*\(/i.test(value)) continue;
    if (shape.test(value)) kept.push(`${property}: ${value}`);
  }
  return kept.join("; ");
}

export function sanitizeHtml(html: string): string {
  const DOMPurify = createDOMPurify(window);

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    const attrName = data.attrName.toLowerCase();

    if (attrName.startsWith("on") || attrName.startsWith("data-")) {
      data.keepAttr = false;
      return;
    }

    if (attrName === "width") {
      if (
        typeof data.attrValue !== "string" ||
        !/^\d{1,4}$/.test(data.attrValue.trim())
      ) {
        data.keepAttr = false;
      }
      return;
    }

    if (attrName === "style") {
      const kept =
        typeof data.attrValue === "string" ? safeStyle(data.attrValue) : "";
      if (kept === "") data.keepAttr = false;
      else data.attrValue = kept;
      return;
    }

    if (
      (attrName === "href" || attrName === "src") &&
      typeof data.attrValue === "string"
    ) {
      const safe =
        attrName === "src" && node.nodeName.toLowerCase() === "img"
          ? isSafeImageSrc(data.attrValue)
          : isSafeUrl(data.attrValue);
      if (!safe) {
        data.keepAttr = false;
      }
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName.toLowerCase() === "a") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}

export function sanitizeProseMirrorJson(json: unknown): ProseMirrorJSON {
  const sanitizedContent = sanitizeNodeOrFragment(json);

  if (sanitizedContent.length === 1 && sanitizedContent[0]?.type === "doc") {
    return sanitizedContent[0];
  }

  return {
    type: "doc",
    content: sanitizedContent,
  };
}
