/**
 * Reading a policy written in Bindersnap's own editor.
 *
 * The editor stores a document as ProseMirror JSON — `document.json` — and
 * until this the page showed that file as what it is on disk: braces, quotes
 * and `"type": "paragraph"`, in a monospace box, to a policy manager who wrote
 * a heading and three paragraphs. A Word file and a PDF both render as a
 * document; the one format the product writes itself was the one it could not
 * read back.
 *
 * Tiptap renders its own JSON: `generateHTML` with the same extensions the
 * editor loads is the editor's output without the editor, so a heading here is
 * the heading the author typed. Imported on demand, so a reader who never opens
 * one of these never downloads Tiptap's schema.
 *
 * **Tolerant of what the editor adds and a reader does not need.** The editor
 * carries its own nodes and marks — comment anchors, merge conflicts — which a
 * schema built without them would refuse outright. They are unwrapped rather
 * than refused: a comment anchor is a mark on words that are still the policy,
 * and losing the whole document over one is the wrong trade.
 */

import type { JSONContent } from "@tiptap/core";

/** Whether a parsed file is a document the editor wrote. */
export function isEditorDocument(value: unknown): value is JSONContent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; content?: unknown };
  return candidate.type === "doc" && Array.isArray(candidate.content);
}

/** The parsed document, or null when the text is not one the editor wrote. */
export function parseEditorDocument(text: string): JSONContent | null {
  const trimmed = text.trimStart();
  // Cheap refusal first: a CSV or a log is not worth a JSON.parse.
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isEditorDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keep only the node and mark types the schema knows.
 *
 * An unknown mark is dropped and its text kept. An unknown node is replaced by
 * its children, so the words inside it survive; one with no children goes.
 */
export function pruneToSchema(
  node: JSONContent,
  nodeTypes: ReadonlySet<string>,
  markTypes: ReadonlySet<string>,
): JSONContent[] {
  const children = (node.content ?? []).flatMap((child) =>
    pruneToSchema(child, nodeTypes, markTypes),
  );

  if (!node.type || !nodeTypes.has(node.type)) return children;

  const pruned: JSONContent = { ...node };
  if (node.content) pruned.content = children;
  if (node.marks) {
    const marks = node.marks.filter((mark) => markTypes.has(mark.type));
    if (marks.length > 0) pruned.marks = marks;
    else delete pruned.marks;
  }
  return [pruned];
}

type Renderer = (doc: JSONContent) => string;

let renderer: Promise<Renderer> | null = null;

/** The editor's schema and serializer, loaded once and kept. */
function loadRenderer(): Promise<Renderer> {
  if (renderer === null) {
    renderer = (async () => {
      const [
        { generateHTML, getSchema },
        { default: StarterKit },
        { default: Image },
        { default: TextAlign },
        { TextStyle, Color, FontFamily, FontSize, LineHeight },
        { default: Highlight },
        { default: TaskList },
        { default: TaskItem },
        { default: Subscript },
        { default: Superscript },
        { Table, TableRow, TableCell, TableHeader },
      ] = await Promise.all([
        import("@tiptap/core"),
        import("@tiptap/starter-kit"),
        import("@tiptap/extension-image"),
        import("@tiptap/extension-text-align"),
        import("@tiptap/extension-text-style"),
        import("@tiptap/extension-highlight"),
        import("@tiptap/extension-task-list"),
        import("@tiptap/extension-task-item"),
        import("@tiptap/extension-subscript"),
        import("@tiptap/extension-superscript"),
        import("@tiptap/extension-table"),
      ]);

      // The editor's list (`packages/editor/Editor.tsx`), less what only
      // matters while typing: placeholders, comment anchors, conflicts.
      const extensions = [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
        Image.configure({ inline: true }),
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        LineHeight,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Subscript,
        Superscript,
        Table,
        TableRow,
        TableCell,
        TableHeader,
      ];

      const schema = getSchema(extensions);
      const nodeTypes = new Set(Object.keys(schema.nodes));
      const markTypes = new Set(Object.keys(schema.marks));

      return (doc: JSONContent) => {
        const [pruned] = pruneToSchema(doc, nodeTypes, markTypes);
        return generateHTML(pruned ?? { type: "doc", content: [] }, extensions);
      };
    })().catch((err: unknown) => {
      // Not remembered, so the next document gets a fresh attempt.
      renderer = null;
      throw err;
    });
  }
  return renderer;
}

/**
 * A document the editor wrote, as HTML — or null when the text is not one.
 *
 * Null is the caller's cue to show the file as the text it is, which is still
 * right for a `.json` that is genuinely data.
 */
export async function editorDocumentToHtml(
  text: string,
): Promise<string | null> {
  const doc = parseEditorDocument(text);
  if (doc === null) return null;
  const render = await loadRenderer();
  return render(doc);
}
