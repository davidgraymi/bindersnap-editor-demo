import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, X } from "lucide-react";

import { getWorkspaceDocuments, type WorkspaceDocumentSummary } from "../api";
import { capitalizeFirst } from "../documentDisplay";
import {
  applyPersonFilter,
  buildDocumentRows,
  buildDocumentsUrl,
  collectOwners,
  describeDocumentCount,
  getSavedViewLabel,
  parseDocumentsViewState,
  SAVED_VIEWS,
  toSearchParams,
  type DocumentRow,
  type DocumentsViewState,
  type SavedView,
} from "../documentsView";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface DocumentsPageProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
}

/** Move the page, and let the app's popstate listener redraw it. */
function navigateTo(state: DocumentsViewState): void {
  window.history.pushState({}, "", buildDocumentsUrl(state));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The library: every document the reader can reach, under one scope at a time.
 *
 * Home answers "what is waiting on me?"; this page answers the other question —
 * "where is that document?" — so it is a list with a scope, a few people, and
 * nothing else. The scope lives in the URL, which is what makes a saved view
 * saveable.
 */
export function DocumentsPage({
  currentUsername,
  onSelectDocument,
}: DocumentsPageProps) {
  const [state, setState] = useState<DocumentsViewState>(() =>
    parseDocumentsViewState(window.location.search, currentUsername),
  );
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  // Pages arrive as the reader scrolls. `page` is the last one that landed;
  // `hasMore` is Gitea's only hint that another might exist.
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Back and forward are the way out of a saved view, so the page follows the
  // address bar rather than its own memory of what was clicked.
  useEffect(() => {
    const handler = () => {
      setState(
        parseDocumentsViewState(window.location.search, currentUsername),
      );
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [currentUsername]);

  // Only the scope and the words travel to the server; a person filter is
  // applied to what comes back.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getWorkspaceDocuments({
      ...toSearchParams(
        { view: state.view, people: [], freeText: state.freeText },
        currentUsername,
      ),
      page: 1,
    })
      .then((fetched) => {
        if (cancelled) return;
        setDocuments(fetched.documents);
        setPage(fetched.page);
        setHasMore(fetched.hasMore);
        setIsLoading(false);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load documents.",
        );
        setDocuments([]);
        setHasMore(false);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state.view, state.freeText, currentUsername]);

  // Scrolling is the only way to ask for more, so the sentinel below the list
  // is what triggers the next page. It is rendered only while one may exist.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || isLoading || isLoadingMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;

      setIsLoadingMore(true);
      getWorkspaceDocuments({
        ...toSearchParams(
          { view: state.view, people: [], freeText: state.freeText },
          currentUsername,
        ),
        page: page + 1,
      })
        .then((fetched) => {
          // A repository can move between pages while the reader scrolls, so
          // rows are merged by identity rather than blindly appended.
          setDocuments((current) => {
            const seen = new Set(current.map((doc) => doc.repo.full_name));
            return [
              ...current,
              ...fetched.documents.filter(
                (doc) => !seen.has(doc.repo.full_name),
              ),
            ];
          });
          setPage(fetched.page);
          setHasMore(fetched.hasMore);
          setIsLoadingMore(false);
        })
        .catch(() => {
          // Stop asking rather than looping on a page that will not load.
          setHasMore(false);
          setIsLoadingMore(false);
        });
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hasMore,
    isLoading,
    isLoadingMore,
    page,
    state.view,
    state.freeText,
    currentUsername,
  ]);

  const visible = useMemo(
    () => applyPersonFilter(documents, state.people),
    [documents, state.people],
  );
  const rows = useMemo(
    () => buildDocumentRows(visible, currentUsername),
    [visible, currentUsername],
  );
  const owners = useMemo(
    () =>
      collectOwners(documents).filter((owner) => !state.people.includes(owner)),
    [documents, state.people],
  );

  function selectView(view: SavedView) {
    setPersonPickerOpen(false);
    navigateTo({ ...state, view });
  }

  function addPerson(login: string) {
    setPersonPickerOpen(false);
    navigateTo({ ...state, people: [...state.people, login] });
  }

  function removePerson(login: string) {
    navigateTo({
      ...state,
      people: state.people.filter((person) => person !== login),
    });
  }

  return (
    <div className="docs-page">
      <h1 className="docs-title">Documents</h1>

      <div className="docs-views">
        {SAVED_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className={`docs-chip${view === state.view ? " docs-chip--on" : ""}`}
            aria-pressed={view === state.view}
            onClick={() => selectView(view)}
          >
            {getSavedViewLabel(view)}
          </button>
        ))}

        <span className="docs-views-divider" aria-hidden="true" />

        {state.people.map((person) => (
          <span key={person} className="docs-chip docs-chip--person">
            Owned by <strong>{capitalizeFirst(person)}</strong>
            <button
              type="button"
              className="docs-chip-remove"
              aria-label={`Remove the filter on ${capitalizeFirst(person)}`}
              onClick={() => removePerson(person)}
            >
              <X size={10} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        ))}

        <PersonPicker
          owners={owners}
          open={personPickerOpen}
          onToggle={() => setPersonPickerOpen((open) => !open)}
          onPick={addPerson}
        />

        <span className="docs-views-spacer" />
        <span className="docs-sorted-by">Sorted by last updated</span>
      </div>

      <section className="docs-list">
        {isLoading ? (
          <DocumentSkeletonRows count={3} />
        ) : error ? (
          <div className="docs-notice">
            <p>{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="docs-notice">
            <p>{describeEmpty(state)}</p>
          </div>
        ) : (
          rows.map((row) => (
            <DocumentRowItem
              key={row.key}
              row={row}
              onOpen={() => onSelectDocument(row.owner, row.repo)}
            />
          ))
        )}
      </section>

      {/* Below the list, so seeing it means the reader wants more. */}
      {hasMore && !isLoading && !error ? (
        <div ref={sentinelRef} className="docs-more">
          {isLoadingMore ? <SkeletonLine /> : null}
        </div>
      ) : null}

      {!isLoading && !error && rows.length > 0 ? (
        <p className="docs-count">
          {describeDocumentCount(state.view, rows.length, documents.length)}
          {hasMore ? " so far" : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Why the list is empty, in terms of what the reader last clicked. */
function describeEmpty(state: DocumentsViewState): string {
  if (state.freeText) {
    return `Nothing matched "${state.freeText}".`;
  }
  if (state.people.length > 0) {
    return "Nobody you filtered by owns a document in this view.";
  }
  return state.view === "owned"
    ? "You do not own any documents yet."
    : "No documents here yet.";
}

function PersonPicker({
  owners,
  open,
  onToggle,
  onPick,
}: {
  owners: string[];
  open: boolean;
  onToggle: () => void;
  onPick: (login: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onToggle();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, onToggle]);

  return (
    <div className="docs-person-picker" ref={ref}>
      <button
        type="button"
        className="docs-chip docs-chip--add"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
      >
        <Plus size={11} strokeWidth={1.5} aria-hidden="true" />
        Filter by person
      </button>

      {open ? (
        <div className="docs-person-menu" role="menu">
          {owners.length === 0 ? (
            <p className="docs-person-menu-empty">
              Nobody else owns a document in this view.
            </p>
          ) : (
            owners.map((owner) => (
              <button
                key={owner}
                type="button"
                className="docs-person-menu-item"
                role="menuitem"
                onClick={() => onPick(owner)}
              >
                {capitalizeFirst(owner)}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function DocumentRowItem({
  row,
  onOpen,
}: {
  row: DocumentRow;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="docs-list-item" onClick={onOpen}>
      <span
        className={`docs-list-item-icon${row.urgent ? " docs-list-item-icon--urgent" : ""}`}
        aria-hidden="true"
      >
        <FileText size={16} strokeWidth={1.4} />
      </span>

      <span className="docs-list-item-body">
        <span className="docs-list-item-name">{row.name}</span>
        <span className="docs-list-item-meta">{row.meta}</span>
      </span>

      <span className={`docs-pill docs-pill--${toneOf(row)}`}>
        {row.statusLabel}
      </span>
    </button>
  );
}

/** Coral for work owed, green for settled, quiet grey for everything else. */
function toneOf(row: DocumentRow): "review" | "approved" | "waiting" {
  if (row.status === "needs_your_review" || row.status === "ready_to_publish") {
    return "review";
  }
  return row.status === "current" ? "approved" : "waiting";
}

function DocumentSkeletonRows({ count }: { count: number }) {
  return (
    <SkeletonGroup label="Loading documents">
      {Array.from({ length: count }, (_, index) => (
        <div className="docs-list-item docs-list-item--skeleton" key={index}>
          <span className="docs-list-item-icon" />
          <span className="bs-skeleton-lines">
            <SkeletonLine width="medium" />
            <SkeletonLine width="short" />
          </span>
        </div>
      ))}
    </SkeletonGroup>
  );
}
