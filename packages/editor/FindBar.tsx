import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { getSearchState } from "./extensions/SearchAndReplace";

/**
 * Find and replace, as a small bar floating at the top of the page — where
 * Google Docs, VS Code and the browser put it — rather than a column beside
 * it. The page does not move when somebody searches, and what was found is
 * marked in the page itself.
 *
 * Ctrl+F opens it, or puts the cursor back in it; Ctrl+H opens it with
 * Replace. Enter and Shift+Enter step through the matches, Escape closes it
 * and goes back to the page.
 */
export function FindBar({
  editor,
  request,
  onClose,
}: {
  editor: Editor;
  /** Bumped by every Ctrl+F or Ctrl+H, to focus the field again. */
  request: { replace: boolean; nonce: number };
  onClose: () => void;
}) {
  const [query, setQuery] = useState(
    () => getSearchState(editor.state)?.query ?? "",
  );
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(request.replace);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (request.replace) setShowReplace(true);
    // Words selected on one line are what is looked for, as in Word and the
    // browser; otherwise the last search, selected, so typing replaces it.
    let looking = queryRef.current;
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      const picked = editor.state.doc.textBetween(from, to, "\n");
      if (
        picked.trim() !== "" &&
        !picked.includes("\n") &&
        picked.length < 200
      ) {
        looking = picked;
        setQuery(picked);
      }
    }
    requestAnimationFrame(() => {
      // Ctrl+H with something to look for goes to what to put instead.
      if (request.replace && looking !== "" && replaceRef.current) {
        replaceRef.current.focus();
        replaceRef.current.select();
        return;
      }
      findRef.current?.focus();
      findRef.current?.select();
    });
  }, [editor, request]);

  // The search runs as you type, and stops marking the page when it closes.
  // An editor React has already torn down — StrictMode builds one twice —
  // has no commands left to run, so every effect here checks first.
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.commands.setSearchQuery(query);
  }, [editor, query]);

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

  const count = search?.count ?? 0;
  const position = search && search.current >= 0 ? search.current + 1 : 0;

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="bs-findbar"
      role="search"
      aria-label="Find in document"
      onKeyDown={onKey}
    >
      <div className="bs-findbar-row">
        {editor.isEditable ? (
          <button
            type="button"
            className="bs-findbar-btn"
            aria-label={showReplace ? "Hide Replace" : "Show Replace"}
            aria-expanded={showReplace}
            title="Replace (Ctrl+H)"
            onClick={() => setShowReplace((was) => !was)}
          >
            {showReplace ? (
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        ) : null}
        <input
          ref={findRef}
          type="text"
          className="bs-findbar-input"
          placeholder="Find in document"
          aria-label="Find in document"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) editor.commands.previousSearchMatch();
              else editor.commands.nextSearchMatch();
            }
          }}
        />
        <span className="bs-findbar-count" aria-live="polite">
          {query === ""
            ? ""
            : count === 0
              ? "No results"
              : `${position} of ${count}`}
        </span>
        <button
          type="button"
          className={`bs-findbar-btn${caseSensitive ? " is-on" : ""}`}
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive((was) => !was)}
        >
          <CaseSensitive size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bs-findbar-btn"
          aria-label="Previous result"
          title="Previous result (Shift+Enter)"
          disabled={count === 0}
          onClick={() => editor.commands.previousSearchMatch()}
        >
          <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bs-findbar-btn"
          aria-label="Next result"
          title="Next result (Enter)"
          disabled={count === 0}
          onClick={() => editor.commands.nextSearchMatch()}
        >
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="bs-findbar-btn"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={close}
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {showReplace && editor.isEditable ? (
        <div className="bs-findbar-row bs-findbar-row--replace">
          <input
            ref={replaceRef}
            type="text"
            className="bs-findbar-input"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && count > 0) {
                event.preventDefault();
                editor.commands.replaceSearchMatch(replacement);
                editor.commands.nextSearchMatch();
              }
            }}
          />
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
            onClick={() => editor.commands.replaceAllSearchMatches(replacement)}
          >
            Replace all
          </button>
        </div>
      ) : null}
    </div>
  );
}
