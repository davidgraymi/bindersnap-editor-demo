import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";

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

/** The panel is wider than the box: a document name is longer than a query. */
const NAV_SEARCH_PANEL_WIDTH = 320;
/** Breathing room between the panel and the edge of the window. */
const NAV_SEARCH_PANEL_MARGIN = 8;
/** And between the panel and the box it belongs to. */
const NAV_SEARCH_PANEL_GAP = 6;

interface NavSearchProps {
  /** Whose workspace this is, so a row can say "You own" instead of a name. */
  currentUsername: string;
  /** The query the address bar arrived with, if the reader linked to one. */
  initialQuery: string;
  /** Open a document — the whole point of the panel. */
  onNavigate: (route: AppRoute) => void;
  /** Fall back to the library, for a search too broad to answer in a panel. */
  onSearchLibrary: (query: string) => void;
}

/**
 * The nav search box, and the panel of documents under it.
 *
 * Typing asks the server directly instead of waiting for a submit, so the
 * document a reader is looking for is usually on screen before they finish
 * naming it. Results come a page at a time and the panel asks for the next
 * one when the reader scrolls to the bottom of what it already has, which
 * keeps the first page fast no matter how many documents match.
 *
 * The keyboard is the fast path all the way through: `/` focuses the box,
 * arrows move down the list, Enter opens the highlighted document, and Enter
 * with nothing highlighted still does what it always did — search the library.
 */
export function NavSearch({
  currentUsername,
  initialQuery,
  onNavigate,
  onSearchLibrary,
}: NavSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<QuickFindResult[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /**
   * Where the panel hangs, in viewport coordinates.
   *
   * The nav clips what overflows it — that is what keeps the avatar from
   * escaping its right edge — so a panel positioned inside it is cut off at
   * the nav's own bottom. The profile menu solves this by being `fixed` at a
   * hardcoded offset, which it can do because it is anchored to the right
   * edge; the search box moves with the viewport, so its panel measures.
   */
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const pageRef = useRef(1);
  /**
   * Which query each response belongs to. Responses can land out of order, and
   * a slow answer to a query the reader has since edited is not an answer.
   */
  const queryRef = useRef(query);

  const closePanel = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  // "/" puts the cursor in search from anywhere — unless the reader is already
  // typing somewhere, where a slash is just a slash.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  // Every settled keystroke is a new first page. The debounce is what keeps a
  // typed word from being eight separate searches.
  useEffect(() => {
    queryRef.current = query;

    if (!isQuickFindQuery(query)) {
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
  }, [query, currentUsername]);

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
        // screen and stop asking rather than emptying the panel underneath
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
      closePanel();
      inputRef.current?.blur();
      onNavigate({
        kind: "document",
        owner: result.owner,
        repo: result.repo,
        tab: "overview",
      });
    },
    [closePanel, onNavigate],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open && results.length > 0) {
        closePanel();
        return;
      }
      setQuery("");
      closePanel();
      inputRef.current?.blur();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
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
    closePanel();
    inputRef.current?.blur();
    onSearchLibrary(query.trim());
  };

  // The highlighted row has to be a row the reader can see, however they moved
  // to it — arrow keys can wrap from the last result back to the first.
  useEffect(() => {
    if (highlight < 0) return;
    const list = listRef.current;
    const row = list?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const showPanel = open && isQuickFindQuery(query);

  useLayoutEffect(() => {
    if (!showPanel) {
      setAnchor(null);
      return;
    }

    const measure = () => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (!box) return;
      // Keep the whole panel on screen when the box sits close to the right
      // edge: it is wider than the box it hangs from.
      const width = Math.max(NAV_SEARCH_PANEL_WIDTH, box.width);
      const maxLeft = window.innerWidth - width - NAV_SEARCH_PANEL_MARGIN;
      setAnchor({
        top: box.bottom + NAV_SEARCH_PANEL_GAP,
        left: Math.max(NAV_SEARCH_PANEL_MARGIN, Math.min(box.left, maxLeft)),
      });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showPanel]);

  const activeId =
    highlight >= 0 && results[highlight]
      ? `nav-search-result-${highlight}`
      : undefined;

  return (
    <div className="app-nav-search-wrap" ref={wrapRef}>
      <form
        className="app-nav-search"
        role="search"
        onSubmit={handleSubmit}
        aria-owns="nav-search-panel"
      >
        <Search
          className="app-nav-search-icon"
          aria-hidden="true"
          size={14}
          strokeWidth={1.5}
        />
        <input
          ref={inputRef}
          className="app-nav-search-input"
          type="text"
          placeholder="Search documents"
          aria-label="Search documents"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="nav-search-panel"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        <span className="app-nav-search-kbd" aria-hidden="true">
          /
        </span>
      </form>

      {showPanel && (
        <>
          <div
            className="app-nav-search-backdrop"
            onMouseDown={closePanel}
            aria-hidden="true"
          />
          <div
            className="app-nav-search-panel"
            id="nav-search-panel"
            role="presentation"
            style={{
              top: anchor?.top ?? 0,
              left: anchor?.left ?? 0,
              // Until the first measurement lands there is nowhere to put it,
              // and a panel in the top-left corner is worse than no panel.
              visibility: anchor ? "visible" : "hidden",
            }}
          >
            {results.length > 0 && (
              <ul
                ref={listRef}
                className="app-nav-search-results"
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
                    id={`nav-search-result-${index}`}
                    className={`app-nav-search-result${
                      index === highlight
                        ? " app-nav-search-result--active"
                        : ""
                    }`}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => {
                      // Mouse-down, not click: the input blurs first otherwise
                      // and the panel is gone before the click lands.
                      event.preventDefault();
                      openResult(result);
                    }}
                  >
                    <span className="app-nav-search-result-name">
                      {result.name}
                    </span>
                    <span className="app-nav-search-result-meta">
                      {result.meta}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {loadingMore && (
              <p className="app-nav-search-note" role="status">
                Loading more…
              </p>
            )}

            {loading && results.length === 0 && (
              <p className="app-nav-search-note" role="status">
                Searching…
              </p>
            )}

            {!loading && failed && (
              <p className="app-nav-search-note">
                Search is unavailable right now.
              </p>
            )}

            {!loading && !failed && results.length === 0 && (
              <p className="app-nav-search-note">
                {describeQuickFindEmptyState(query)}
              </p>
            )}

            <button
              type="button"
              className="app-nav-search-all"
              onMouseDown={(event) => {
                event.preventDefault();
                closePanel();
                inputRef.current?.blur();
                onSearchLibrary(query.trim());
              }}
            >
              See all matches in Documents
            </button>
          </div>
        </>
      )}
    </div>
  );
}
