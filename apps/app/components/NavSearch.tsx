import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";

import {
  bindersQuery,
  changeSearchQuery,
  organizationMembersQuery,
  organizationsQuery,
  searchQuery,
} from "../data/queries";
import type { QuickFindResult } from "../quickFind";
import {
  buildActionResult,
  buildBinderResult,
  buildChangeResult,
  buildOrganizationResult,
  buildPersonResult,
  buildQuickFindResults,
  describeQuickFindEmptyState,
  isQuickFindQuery,
  matchesQuickFindQuery,
  moveQuickFindHighlight,
  orderQuickFindResults,
  QUICK_FIND_DEBOUNCE_MS,
  QUICK_FIND_GROUP_LABELS,
  QUICK_FIND_PAGE_SIZE,
} from "../quickFind";
import {
  listQuickFindActions,
  matchQuickFindActions,
  type QuickFindActionContext,
  type QuickFindCommand,
} from "../quickFindActions";
import type { AppRoute } from "../routes";

/**
 * How many binders and how many people one search may list.
 *
 * Documents page; these do not. They are short lists filtered in the browser,
 * and a reader who typed two letters should not get forty names between them
 * and the policy they were after.
 */
const QUICK_FIND_KIND_LIMIT = 4;

/**
 * How many of Bindersnap's own pages and controls one search may list.
 *
 * One more than the other short lists: "people" is the organization's People
 * & access and the binder's, and "help" is the help index and its guides.
 */
const QUICK_FIND_ACTION_LIMIT = 5;

/** The search's name, on the button, the field and the dialog alike. */
const SEARCH_LABEL = "Search Bindersnap";

interface NavSearchProps {
  /** Whose workspace this is, so a row can say "You own" instead of a name. */
  currentUsername: string;
  /**
   * The organization whose binders and people are searchable, or null before
   * one is known. Null narrows the panel back to documents rather than
   * failing — a search that returns policies is still useful.
   */
  org: string | null;
  /** The query the address bar arrived with, if the reader linked to one. */
  initialQuery: string;
  /** Open a document — the whole point of the overlay. */
  onNavigate: (route: AppRoute) => void;
  /** Fall back to the library, for a search too broad to answer in a list. */
  onSearchLibrary: (query: string) => void;
  /**
   * Where the reader is and what they may do, which decides the pages and
   * controls on offer. Absent, only the pages everyone has are.
   */
  actionContext?: QuickFindActionContext;
  /** Carry out a control picked from the list: the theme, the sidebar… */
  onCommand?: (command: QuickFindCommand) => void;
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
  org,
  initialQuery,
  onNavigate,
  onSearchLibrary,
  actionContext,
  onCommand = () => undefined,
}: NavSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(-1);
  /** What was typed, once typing has paused — the question actually asked. */
  const [settled, setSettled] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
      // Claimed nearer the focus: in the editor ⌘K is Insert Link, as it is
      // in Word, and the editor says so by handling it first.
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;
      // ⌘K works mid-sentence too, wherever nothing nearer claims it.
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
    if (!open || !isQuickFindQuery(query)) {
      setSettled(null);
      return;
    }
    const timer = setTimeout(() => setSettled(query), QUICK_FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query]);

  // Documents come from the server, which knows how to search them. Binders
  // and people are two short lists the reader already has access to — and the
  // sidebar and People page have usually read them already — so they come
  // from the shared cache and are matched here. Neither can fail the panel: a
  // document search that works is still worth showing when they do not.
  const asking = settled !== null;
  const found = useQuery({
    ...searchQuery(settled ?? "", QUICK_FIND_PAGE_SIZE),
    enabled: asking,
  });
  // Change requests are searched by Gitea, by title, like documents. Binders,
  // organizations and people are the reader's own short lists, across every
  // organization they are in — not only the one the page is about.
  const changes = useQuery({
    ...changeSearchQuery(settled ?? ""),
    enabled: asking,
  });
  const binders = useQuery({ ...bindersQuery(), enabled: asking });
  const organizations = useQuery({ ...organizationsQuery(), enabled: asking });
  const memberLists = useQueries({
    queries: (organizations.data ?? []).map((organization) => ({
      // Names and owners only: the People page's read answers for every
      // group too, which quick find never shows.
      ...organizationMembersQuery(organization.name),
      enabled: asking,
    })),
  });
  const membersPending = memberLists.some((list) => list.isPending);
  const ready =
    found.data !== undefined &&
    !changes.isPending &&
    !binders.isPending &&
    !organizations.isPending &&
    !membersPending;

  // Bindersnap's own pages and controls are a list held right here, so they
  // are matched on every keystroke rather than after the debounce: "help" is
  // on screen as the last letter lands, whatever the server is doing.
  const actionRows = useMemo<QuickFindResult[]>(() => {
    if (!open || !isQuickFindQuery(query)) return [];
    const offered = listQuickFindActions(
      actionContext ?? {
        org,
        orgName: "",
        binder: null,
        isSiteAdmin: false,
        theme: "light",
        sidebarCollapsed: null,
        canSendFeedback: false,
        canShowGuide: false,
      },
    );
    return matchQuickFindActions(offered, query, QUICK_FIND_ACTION_LIMIT).map(
      buildActionResult,
    );
  }, [open, query, actionContext, org]);

  const foundRows = useMemo<QuickFindResult[]>(() => {
    if (settled === null || !ready || !found.data) return [];
    const asked = settled;

    const changeRows = (changes.data ?? []).map(buildChangeResult);

    const binderRows = (binders.data ?? [])
      .filter((binder) =>
        matchesQuickFindQuery(
          `${binder.name} ${binder.description ?? ""}`,
          asked,
        ),
      )
      .slice(0, QUICK_FIND_KIND_LIMIT)
      .map((binder) => buildBinderResult(binder.owner, binder));

    const organizationRows = (organizations.data ?? [])
      .filter((organization) =>
        matchesQuickFindQuery(
          `${organization.name} ${organization.displayName}`,
          asked,
        ),
      )
      .slice(0, QUICK_FIND_KIND_LIMIT)
      .map(buildOrganizationResult);

    // Somebody in two of your organizations is one person, listed once.
    const seen = new Set<string>();
    const personRows = (organizations.data ?? [])
      .flatMap((organization, index) =>
        (memberLists[index]?.data?.people ?? []).map((person) => ({
          organization: organization.name,
          person,
        })),
      )
      .filter(({ person }) => {
        if (seen.has(person.login)) return false;
        seen.add(person.login);
        return matchesQuickFindQuery(
          `${person.login} ${person.fullName}`,
          asked,
        );
      })
      .slice(0, QUICK_FIND_KIND_LIMIT)
      .map(({ organization, person }) =>
        buildPersonResult(organization, {
          username: person.login,
          fullName: person.fullName,
          // An owner is the one fact worth saying on a one-line result;
          // everything else is a question the People page answers.
          role: person.isOwner ? "Owner" : undefined,
        }),
      );

    return orderQuickFindResults([
      ...buildQuickFindResults(found.data.documents),
      ...changeRows,
      ...binderRows,
      ...organizationRows,
      ...personRows,
    ]);
    // memberLists is a new array every render; its data is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settled,
    ready,
    found.data,
    changes.data,
    binders.data,
    organizations.data,
    memberLists.map((list) => list.dataUpdatedAt).join(","),
  ]);

  // Already in order: the actions first, then what was found.
  const results = useMemo(
    () => [...actionRows, ...foundRows],
    [actionRows, foundRows],
  );
  // What the list holds, rather than the list: a new action context with the
  // same rows in it is not a new answer, and should not lose the highlight.
  const resultKeys = results.map((result) => result.key).join("\n");

  const hasMore = asking && (found.data?.hasMore ?? false);
  const failed = asking && found.isError;
  const loading =
    open &&
    isQuickFindQuery(query) &&
    (settled !== query || found.isFetching || !ready) &&
    !failed;

  useEffect(() => {
    setHighlight(-1);
  }, [resultKeys]);

  /** The person whose username was just copied, so their row can say so. */
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setCopied(null), [settled]);

  const openResult = useCallback(
    (result: QuickFindResult) => {
      // **A person is copied, not opened.** There is no page for one person,
      // and a person in two organizations has no one People page to go to.
      // What somebody looking a person up does next is name them somewhere
      // — ask them to review, add them to a binder or a group — and every
      // one of those boxes takes a username. So the panel stays open and
      // says what it did.
      if (result.kind === "person" && result.username) {
        const username = result.username;
        void navigator.clipboard
          ?.writeText(username)
          .then(() => setCopied(result.key))
          .catch(() => setCopied(null));
        return;
      }

      closeOverlay();

      if (result.action) {
        const target = result.action.target;
        if (target.kind === "route") onNavigate(target.route);
        // Beside the app, as the menus open help: reading about a step should
        // never lose the place where you were doing it.
        else if (target.kind === "link")
          window.open(target.href, "_blank", "noopener");
        else onCommand(target.command);
        return;
      }

      if (result.kind === "binder" && result.binder) {
        onNavigate({
          kind: "binder",
          org: result.organization,
          binder: result.binder,
        });
        return;
      }

      if (result.kind === "change" && result.binder && result.changeNumber) {
        onNavigate({
          kind: "binder",
          org: result.organization,
          binder: result.binder,
          tab: "changes",
          change: result.changeNumber,
        });
        return;
      }

      if (result.kind === "organization") {
        onNavigate({ kind: "organization", org: result.organization });
        return;
      }

      if (result.binder && result.slugPath) {
        onNavigate({
          kind: "binderDocument",
          org: result.organization,
          binder: result.binder,
          documentPath: result.slugPath,
        });
      }
    },
    [closeOverlay, onCommand, onNavigate],
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
        aria-label={SEARCH_LABEL}
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
            placeholder="Search documents, people, pages and settings"
            aria-label={SEARCH_LABEL}
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
              aria-label="Matches"
            >
              {results.map((result, index) => (
                <Fragment key={result.key}>
                  {/* A heading above the first row of each kind. Three kinds in
                      one flat list is a jumble; a heading costs one line and
                      says which question each run of rows answers. Presentational
                      so the arrow keys still see a flat list of options and the
                      indices stay in step with `results`. */}
                  {index === 0 || results[index - 1]!.kind !== result.kind ? (
                    <li className="quick-find-group" role="presentation">
                      {QUICK_FIND_GROUP_LABELS[result.kind]}
                    </li>
                  ) : null}
                  <li
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
                        {copied === result.key
                          ? `Copied ${result.username} — paste it wherever you add somebody`
                          : result.kind === "person" && index === highlight
                            ? `${result.meta} · Enter copies the username`
                            : result.meta}
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
                </Fragment>
              ))}
            </ul>
          )}

          {/* Said aloud as well as on the row: a copy happens nowhere a
              screen reader would otherwise look. */}
          <p className="sr-only" role="status">
            {copied
              ? `Copied ${results.find((result) => result.key === copied)?.username ?? ""}`
              : ""}
          </p>

          {hasMore && (
            <p className="quick-find-note" role="status">
              More match than fit here — keep typing, or press Enter to search
              every document.
            </p>
          )}

          {!searching && (
            <p className="quick-find-note">
              Type to search every document you can see, and Bindersnap’s own
              pages and settings.
            </p>
          )}

          {searching && loading && foundRows.length === 0 && (
            <p className="quick-find-note" role="status">
              {actionRows.length > 0 ? "Searching documents…" : "Searching…"}
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
        aria-label={SEARCH_LABEL}
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
          {query.trim() || SEARCH_LABEL}
        </span>
        {/* ⌘K, not "/". Both open it and always have — but the hint is the half
            a reader learns from, and "/" is a reflex from vim and GitHub while
            ⌘K is the one this audience has already met in Notion, Slack and
            Linear. */}
        <span className="app-nav-search-kbd" aria-hidden="true">
          ⌘K
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
