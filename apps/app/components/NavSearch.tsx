import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";

import { searchDocuments } from "../api";
import type { QuickFindResult } from "../quickFind";
import {
  appendQuickFindPage,
  buildQuickFindResults,
  describeQuickFindEmptyState,
  isQuickFindQuery,
  moveQuickFindHighlight,
  QUICK_FIND_DEBOUNCE_MS,
  QUICK_FIND_PAGE_SIZE,
  shouldLoadNextQuickFindPage,
} from "../quickFind";
import type { AppRoute } from "../routes";

interface NavSearchProps {
  /** Whose workspace this is, so a row can say "You own" instead of a name. */
  currentUsername: string;
  /** The query the address bar arrived with, if the reader linked to one. */
  initialQuery: string;
  /** Open a document — the whole point of the overlay. */
  onNavigate: (route: AppRoute) => void;
  /** Fall back to the library, for a search too broad to answer in a list. */
  onSearchLibrary: (query: string) => void;
}

/**
 * Quick find: the nav's search, opened as an overlay over the whole page.
 *
 * The nav holds a button, not a field. Pressing it — or `/`, or ⌘K — puts the
 * search in front of the reader instead of off in the corner: a dimmed page,
 * a wide field near the top, and results directly under it. Browsing a list
 * of documents is the main thing this does, and a list you read straight
 * ahead is easier than one squeezed under a 260px box.
 *
 * Typing asks the server instead of waiting for a submit, so the document
 * someone is looking for is usually on screen before they finish naming it.
 * Results come a page at a time and the next page is fetched when the reader
 * scrolls to the bottom of the list.
 *
 * The keyboard is the fast path all the way through: arrows move down the
 * list, Enter opens the highlighted document, Enter with nothing highlighted
 * searches the library, and Escape closes without going anywhere.
 */
export function NavSearch({
  currentUsername,
  initialQuery,
  onNavigate,
  onSearchLibrary,
}: NavSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<QuickFindResult[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(1);
  /**
   * Which query each response belongs to. Responses can land out of order, and
   * a slow answer to a query the reader has since edited is not an answer.
   */
  const queryRef = useRef(query);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
    // Closing puts the reader back where they were, which for a keyboard is
    // the button they opened this from.
    triggerRef.current?.focus();
  }, []);

  // `/` and ⌘K both open it from anywhere — unless the reader is already
  // typing somewhere, where a slash is just a slash.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCommandK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash =
        event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isCommandK && !isSlash) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;
      // ⌘K is a chord nothing else claims, so it works mid-sentence too.
      if (typing && !isCommandK) return;

      event.preventDefault();
      setOpen(true);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The field is the only thing anyone opens this to reach.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Every settled keystroke is a new first page. The debounce is what keeps a
  // typed word from being eight separate searches.
  useEffect(() => {
    queryRef.current = query;

    if (!open || !isQuickFindQuery(query)) {
      setResults([]);
      setHasMore(false);
      setLoading(false);
      setFailed(false);
      return;
    }

    setLoading(true);
    setFailed(false);

    const timer = setTimeout(() => {
      const asked = query;
      void searchDocuments(asked, 1, QUICK_FIND_PAGE_SIZE)
        .then((payload) => {
          if (queryRef.current !== asked) return;
          pageRef.current = payload.page;
          setResults(buildQuickFindResults(payload.documents, currentUsername));
          setHasMore(payload.hasMore);
          setHighlight(-1);
        })
        .catch(() => {
          if (queryRef.current !== asked) return;
          setResults([]);
          setHasMore(false);
          setFailed(true);
        })
        .finally(() => {
          if (queryRef.current !== asked) return;
          setLoading(false);
        });
    }, QUICK_FIND_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [open, query, currentUsername]);

  const loadNextPage = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;

    const asked = queryRef.current;
    const nextPage = pageRef.current + 1;
    setLoadingMore(true);

    void searchDocuments(asked, nextPage, QUICK_FIND_PAGE_SIZE)
      .then((payload) => {
        if (queryRef.current !== asked) return;
        pageRef.current = payload.page;
        setResults((current) =>
          appendQuickFindPage(
            current,
            buildQuickFindResults(payload.documents, currentUsername),
          ),
        );
        setHasMore(payload.hasMore);
      })
      .catch(() => {
        if (queryRef.current !== asked) return;
        // A page that failed is not a search that failed: keep what is on
        // screen and stop asking rather than emptying the list underneath
        // the reader.
        setHasMore(false);
      })
      .finally(() => {
        if (queryRef.current !== asked) return;
        setLoadingMore(false);
      });
  }, [currentUsername, hasMore, loading, loadingMore]);

  const openResult = useCallback(
    (result: QuickFindResult) => {
      closeOverlay();
      onNavigate({
        kind: "document",
        owner: result.owner,
        repo: result.repo,
        tab: "overview",
      });
    },
    [closeOverlay, onNavigate],
  );

  const searchLibrary = useCallback(() => {
    closeOverlay();
    onSearchLibrary(query.trim());
  }, [closeOverlay, onSearchLibrary, query]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setHighlight((current) =>
        moveQuickFindHighlight(
          current,
          event.key === "ArrowDown" ? 1 : -1,
          results.length,
        ),
      );
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const picked = highlight >= 0 ? results[highlight] : undefined;
    if (picked) {
      openResult(picked);
      return;
    }
    searchLibrary();
  };

  /**
   * Escape closes from anywhere inside, and Tab stays inside while it is open.
   *
   * Everything behind the dim is out of reach for a mouse, and a modal that
   * lets the keyboard wander back there is a modal only for people using a
   * mouse.
   */
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "input, button:not([disabled])",
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // The highlighted row has to be a row the reader can see, however they moved
  // to it — arrow keys can wrap from the last result back to the first.
  useEffect(() => {
    if (highlight < 0) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const activeId =
    highlight >= 0 && results[highlight]
      ? `quick-find-result-${highlight}`
      : undefined;
  const searching = isQuickFindQuery(query);

  const overlay = (
    <div
      className="quick-find-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeOverlay();
      }}
    >
      <div
        className="quick-find-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search documents"
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
      >
        <form
          className="quick-find-field"
          role="search"
          onSubmit={handleSubmit}
        >
          <Search
            className="quick-find-field-icon"
            aria-hidden="true"
            size={18}
            strokeWidth={1.5}
          />
          <input
            ref={inputRef}
            className="quick-find-input"
            type="text"
            placeholder="Search documents"
            aria-label="Search documents"
            role="combobox"
            aria-expanded={searching}
            aria-controls="quick-find-results"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="quick-find-field-hint" aria-hidden="true">
            Esc
          </span>
        </form>

        <div className="quick-find-body">
          {results.length > 0 && (
            <ul
              ref={listRef}
              className="quick-find-results"
              id="quick-find-results"
              role="listbox"
              aria-label="Matching documents"
              onScroll={(event) => {
                const list = event.currentTarget;
                if (
                  shouldLoadNextQuickFindPage(
                    list.scrollTop,
                    list.clientHeight,
                    list.scrollHeight,
                  )
                ) {
                  loadNextPage();
                }
              }}
            >
              {results.map((result, index) => (
                <li
                  key={result.key}
                  id={`quick-find-result-${index}`}
                  className={`quick-find-result${
                    index === highlight ? " quick-find-result--active" : ""
                  }`}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => {
                    // Mouse-down, not click: the input blurs first otherwise
                    // and the row is gone before the click lands.
                    event.preventDefault();
                    openResult(result);
                  }}
                >
                  <span className="quick-find-result-copy">
                    <span className="quick-find-result-name">
                      {result.name}
                    </span>
                    <span className="quick-find-result-meta">
                      {result.meta}
                    </span>
                  </span>
                  {index === highlight && (
                    <CornerDownLeft
                      className="quick-find-result-enter"
                      aria-hidden="true"
                      size={14}
                      strokeWidth={1.5}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {loadingMore && (
            <p className="quick-find-note" role="status">
              Loading more…
            </p>
          )}

          {!searching && (
            <p className="quick-find-note">
              Type to search every document you can see.
            </p>
          )}

          {searching && loading && results.length === 0 && (
            <p className="quick-find-note" role="status">
              Searching…
            </p>
          )}

          {searching && !loading && failed && (
            <p className="quick-find-note">Search is unavailable right now.</p>
          )}

          {searching && !loading && !failed && results.length === 0 && (
            <p className="quick-find-note">
              {describeQuickFindEmptyState(query)}
            </p>
          )}
        </div>

        <div className="quick-find-footer">
          <button
            type="button"
            className="quick-find-all"
            disabled={!searching}
            onMouseDown={(event) => {
              event.preventDefault();
              searchLibrary();
            }}
          >
            See all matches in Documents
          </button>
          <span className="quick-find-legend" aria-hidden="true">
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>↵</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="app-nav-search-trigger"
        onClick={() => setOpen(true)}
        // Named here rather than by its own text: on a phone the label and the
        // shortcut hint are gone and only the icon is left.
        aria-label="Search documents"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search
          className="app-nav-search-icon"
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
        />
        <span className="app-nav-search-trigger-label">
          {query.trim() || "Search documents"}
        </span>
        <span className="app-nav-search-kbd" aria-hidden="true">
          /
        </span>
      </button>

      {/*
        Into the body, not the nav: the nav clips what overflows it so the
        avatar cannot escape its right edge, and an overlay is nothing but
        overflow.
      */}
      {open && createPortal(overlay, document.body)}
    </>
  );
}
