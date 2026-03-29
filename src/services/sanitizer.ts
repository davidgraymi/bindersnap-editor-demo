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
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
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

const EMBEDDED_FRAGMENT_ATTRS = new Set(["ourContent", "theirContent", "baseContent"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenScheme(value: string): boolean {
  return /^\s*(?:javascript|vbscript|data):/i.test(value);
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return false;
  }

  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("?")) {
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

    sanitizedMarks.push(sanitizedMark as NonNullable<JSONContent["marks"]>[number]);
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
    if (typeof attrs.src !== "string" || !isSafeUrl(attrs.src)) {
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
    const content = value.content.flatMap((item) => sanitizeNodeOrFragment(item));
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

export function sanitizeHtml(html: string): string {
  const DOMPurify = createDOMPurify(window);

  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const attrName = data.attrName.toLowerCase();

    if (attrName.startsWith("on") || attrName.startsWith("data-") || attrName === "style") {
      data.keepAttr = false;
      return;
    }

    if ((attrName === "href" || attrName === "src") && typeof data.attrValue === "string") {
      if (!isSafeUrl(data.attrValue)) {
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
    FORBID_ATTR: ["style"],
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
