import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { documentOutline, type OutlineEntry } from "./documentStats";
import { getSearchState } from "./extensions/SearchAndReplace";

/**
 * Word's navigation pane: the document's headings, and find and replace.
 *
 * **The outline is the way around a long policy.** A forty-page infection
 * control manual is navigated by its headings, and the pane is where Word
 * puts them — click one and the page goes there. Search lives in the same
 * pane, as in Word, so finding a phrase does not cover the text it found.
 */

interface NavigationPaneProps {
  editor: Editor;
  /** Which part the pane opens on; bumped to re-focus the search field. */
  mode: { view: "headings" | "search"; replace: boolean; nonce: number };
  onClose: () => void;
}

export function NavigationPane({ editor, mode, onClose }: NavigationPaneProps) {
  const [view, setView] = useState<"headings" | "search">(mode.view);
  const [showReplace, setShowReplace] = useState(mode.replace);
  const [query, setQuery] = useState(
    () => getSearchState(editor.state)?.query ?? "",
  );
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setView(mode.view);
    if (mode.replace) setShowReplace(true);
    if (mode.view === "search") {
      // Word selects the field's text so typing replaces the last search.
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    }
  }, [mode]);

  // The search runs as you type, and stops highlighting when the pane closes.
  // An editor React has already torn down — StrictMode builds one twice —
  // has no commands left to run, so every effect here checks first.
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.commands.setSearchQuery(view === "search" ? query : "");
  }, [editor, query, view]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.commands.setSearchCaseSensitive(caseSensitive);
  }, [editor, caseSensitive]);

  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.commands.clearSearch();
    },
    [editor],
  );

  const search = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = current.isDestroyed
        ? undefined
        : getSearchState(current.state);
      return {
        count: state?.matches.length ?? 0,
        current: state?.current ?? -1,
      };
    },
    equalityFn: (a, b) => a?.count === b?.count && a?.current === b?.current,
  });

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

  const count = search?.count ?? 0;
  const position = search && search.current >= 0 ? search.current + 1 : 0;

  return (
    <aside className="bs-navpane" aria-label="Navigation">
      <div className="bs-navpane-head">
        <h2 className="bs-navpane-title">Navigation</h2>
        <button
          type="button"
          className="bs-navpane-close"
          aria-label="Close the navigation pane"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="bs-navpane-search">
        <input
          ref={searchRef}
          type="search"
          className="bs-navpane-input"
          placeholder="Search document"
          aria-label="Search document"
          value={query}
          onFocus={() => setView("search")}
          onChange={(event) => {
            setQuery(event.target.value);
            setView("search");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) editor.commands.previousSearchMatch();
              else editor.commands.nextSearchMatch();
            }
            if (event.key === "Escape" && query !== "") {
              event.preventDefault();
              setQuery("");
            }
          }}
        />
        {view === "search" && query !== "" ? (
          <div className="bs-navpane-found">
            <span aria-live="polite">
              {count === 0
                ? "No results"
                : `${position} of ${count} result${count === 1 ? "" : "s"}`}
            </span>
            <span className="bs-navpane-steps">
              <button
                type="button"
                aria-label="Previous result"
                title="Previous result (Shift+Enter)"
                disabled={count === 0}
                onClick={() => editor.commands.previousSearchMatch()}
              >
                <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next result"
                title="Next result (Enter)"
                disabled={count === 0}
                onClick={() => editor.commands.nextSearchMatch()}
              >
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}

        {view === "search" ? (
          <>
            <label className="bs-navpane-check">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
              />
              Match case
            </label>
            {showReplace ? (
              <div className="bs-navpane-replace">
                <input
                  type="text"
                  className="bs-navpane-input"
                  placeholder="Replace with"
                  aria-label="Replace with"
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
                <div className="bs-navpane-replace-actions">
                  <button
                    type="button"
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    disabled={count === 0}
                    onClick={() => {
                      editor.commands.replaceSearchMatch(replacement);
                      editor.commands.nextSearchMatch();
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    disabled={count === 0}
                    onClick={() =>
                      editor.commands.replaceAllSearchMatches(replacement)
                    }
                  >
                    Replace all
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="bs-navpane-link"
                onClick={() => setShowReplace(true)}
              >
                Replace…
              </button>
            )}
          </>
        ) : null}
      </div>

      <div className="bs-navpane-tabs" role="tablist" aria-label="Show">
        <button
          type="button"
          role="tab"
          aria-selected={view === "headings"}
          className={`bs-navpane-tab${view === "headings" ? " is-on" : ""}`}
          onClick={() => setView("headings")}
        >
          Headings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "search"}
          className={`bs-navpane-tab${view === "search" ? " is-on" : ""}`}
          onClick={() => {
            setView("search");
            searchRef.current?.focus();
          }}
        >
          Results
        </button>
      </div>

      {view === "headings" ? (
        !outline || outline.length === 0 ? (
          <p className="bs-navpane-empty">
            Headings you add to the document show up here, as a way to move
            around it. Use the Styles on the Home tab to make one.
          </p>
        ) : (
          <ol className="bs-outline">
            {outline.map((entry) => (
              <li key={entry.pos}>
                <button
                  type="button"
                  className={`bs-outline-item bs-outline-item--h${Math.min(
                    entry.level,
                    4,
                  )}${activeHeading === entry.pos ? " is-on" : ""}`}
                  aria-current={
                    activeHeading === entry.pos ? "location" : undefined
                  }
                  onClick={() => goTo(entry)}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ol>
        )
      ) : (
        <SearchResults editor={editor} />
      )}
    </aside>
  );
}

/** Each match with the words around it, as Word's Results tab lists them. */
function SearchResults({ editor }: { editor: Editor }) {
  const results = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = current.isDestroyed
        ? undefined
        : getSearchState(current.state);
      if (!state) return [];
      return state.matches.slice(0, 200).map((match, index) => {
        const $from = current.state.doc.resolve(match.from);
        const block = $from.parent;
        const start = $from.start();
        const text = block.textContent;
        const at = match.from - start;
        const end = match.to - start;
        return {
          index,
          current: index === state.current,
          before: text.slice(Math.max(0, at - 32), at),
          match: text.slice(at, end),
          after: text.slice(end, end + 48),
          from: match.from,
          to: match.to,
        };
      });
    },
    equalityFn: (a, b) =>
      !!a &&
      !!b &&
      a.length === b.length &&
      a.every(
        (entry, index) =>
          entry.from === b[index]?.from && entry.current === b[index]?.current,
      ),
  });

  if (!results || results.length === 0) {
    return (
      <p className="bs-navpane-empty">
        Type in the search box to find every place a word or phrase is used.
      </p>
    );
  }

  return (
    <ol className="bs-results">
      {results.map((result) => (
        <li key={result.from}>
          <button
            type="button"
            className={`bs-result${result.current ? " is-on" : ""}`}
            onClick={() =>
              editor
                .chain()
                .focus()
                .setTextSelection({ from: result.from, to: result.to })
                .scrollIntoView()
                .run()
            }
          >
            {result.before.length > 0 && result.before.length >= 32 ? "…" : ""}
            {result.before}
            <mark>{result.match}</mark>
            {result.after}
          </button>
        </li>
      ))}
    </ol>
  );
}
