import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";

import { documentOutline, type OutlineEntry } from "./documentStats";

/**
 * The document's headings, as Word's navigation pane lists them: the way
 * around a long policy. A forty-page infection control manual is navigated
 * by its headings — click one and the page goes there.
 *
 * It has no frame of its own. The page around the editor places it — in the
 * app, as the file panel's Outline tab — so the binder's files and this
 * document's headings share one panel instead of standing side by side.
 */
export function DocumentOutline({ editor }: { editor: Editor }) {
  const outline = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current.isDestroyed ? [] : documentOutline(current.state.doc),
    equalityFn: (a, b) =>
      !!a &&
      !!b &&
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.text === b[index]?.text &&
          entry.level === b[index]?.level &&
          entry.pos === b[index]?.pos,
      ),
  });

  const activeHeading = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (current.isDestroyed) return null;
      const at = current.state.selection.from;
      let active: number | null = null;
      for (const entry of documentOutline(current.state.doc)) {
        if (entry.pos <= at) active = entry.pos;
        else break;
      }
      return active;
    },
  });

  const goTo = (entry: OutlineEntry) => {
    editor
      .chain()
      .focus()
      .setTextSelection(entry.pos + 1)
      .scrollIntoView()
      .run();
    // Put the heading at the top of the page, where Word puts it, rather than
    // wherever the minimal scroll happens to leave it.
    const dom = editor.view.nodeDOM(entry.pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  if (!outline || outline.length === 0) {
    return (
      <p className="bs-outline-empty">
        Headings you add to the document show up here, as a way to move around
        it. Use the Styles on the Home tab to make one.
      </p>
    );
  }

  return (
    <ol className="bs-outline" aria-label="Headings">
      {outline.map((entry) => (
        <li key={entry.pos}>
          <button
            type="button"
            className={`bs-outline-item bs-outline-item--h${Math.min(
              entry.level,
              4,
            )}${activeHeading === entry.pos ? " is-on" : ""}`}
            aria-current={activeHeading === entry.pos ? "location" : undefined}
            title={entry.text}
            onClick={() => goTo(entry)}
          >
            {entry.text}
          </button>
        </li>
      ))}
    </ol>
  );
}
