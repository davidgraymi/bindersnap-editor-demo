import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";

import { fetchLibrary, type LibraryPayload } from "../api";
import {
  applyBinderFilter,
  binderKey,
  buildDocumentRows,
  buildDocumentsUrl,
  describeDocumentCount,
  getDocumentRowStatusLabel,
  parseDocumentsViewState,
  type DocumentsViewState,
} from "../documentsView";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface DocumentsPageProps {
  onSelectDocument: (org: string, binder: string, slugPath: string) => void;
}

/** Move the page, and let the app's popstate listener redraw it. */
function navigateTo(state: DocumentsViewState): void {
  window.history.pushState({}, "", buildDocumentsUrl(state));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The library: every policy the reader can reach, across every binder.
 *
 * Home answers "what is waiting on me?"; this page answers the other question,
 * "where is that policy?" — so it is a list, a search box, and one filter.
 *
 * **Unpaged, and that is not a regression.** The old page scrolled through
 * pages of repositories because each one was a document and Gitea paged them.
 * The server now reads each binder once, three calls whatever it holds, so
 * there is no cheaper page to ask for: fetching page two would repeat the whole
 * read. A customer with four hundred policies in five binders is one request.
 *
 * Grouped by binder rather than sorted flat, because the binder is what decides
 * who can see a policy and what has to happen before it changes — two policies
 * with the same name in different binders are different objects, and a flat
 * list would make them look like duplicates.
 */
export function DocumentsPage({ onSelectDocument }: DocumentsPageProps) {
  const [state, setState] = useState<DocumentsViewState>(() =>
    parseDocumentsViewState(window.location.search),
  );
  const [library, setLibrary] = useState<LibraryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Back and forward are the way out of a filter, so the page follows the
  // address bar rather than its own memory of what was clicked.
  useEffect(() => {
    const onPopState = () =>
      setState(parseDocumentsViewState(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLibrary(null);
    setError(null);

    fetchLibrary(state.freeText || undefined)
      .then((payload) => {
        if (!cancelled) setLibrary(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to load your policies.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [state.freeText]);

  const rows = useMemo(
    () =>
      applyBinderFilter(
        buildDocumentRows(library?.documents ?? []),
        state.binder,
      ),
    [library, state.binder],
  );

  const grouped = useMemo(() => {
    const byBinder = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = binderKey(row);
      const existing = byBinder.get(key);
      if (existing) existing.push(row);
      else byBinder.set(key, [row]);
    }
    return [...byBinder.entries()];
  }, [rows]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  return (
    <section className="docs-page">
      <h1 className="docs-title">Policies</h1>
      <p className="docs-count">
        {library === null
          ? "Reading your binders…"
          : `${describeDocumentCount(rows.length)} across ${
              library.binders.length === 1
                ? "1 binder"
                : `${library.binders.length} binders`
            }`}
      </p>

      <div className="docs-views">
        <input
          className="bs-input docs-search"
          type="search"
          value={state.freeText}
          placeholder="Search policies"
          aria-label="Search policies"
          onChange={(event) => {
            const next = { ...state, freeText: event.target.value };
            setState(next);
            navigateTo(next);
          }}
        />

        {library && library.binders.length > 1 ? (
          <select
            className="bs-input docs-binder-filter"
            value={state.binder ?? ""}
            aria-label="Which binder"
            onChange={(event) => {
              const next = { ...state, binder: event.target.value || null };
              setState(next);
              navigateTo(next);
            }}
          >
            <option value="">Every binder</option>
            {library.binders.map((binder) => (
              <option
                key={binderKey({
                  organization: binder.organization,
                  binder: binder.name,
                })}
                value={binderKey({
                  organization: binder.organization,
                  binder: binder.name,
                })}
              >
                {binder.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {library === null ? (
        <SkeletonGroup label="Reading your policies">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      ) : rows.length === 0 ? (
        <p className="doc-rail-note">
          {state.freeText
            ? `Nothing matches “${state.freeText}”.`
            : library.binders.length === 0
              ? "You are not in a binder yet. A policy is filed in one, so a binder comes first."
              : "None of your binders holds a policy yet."}
        </p>
      ) : (
        grouped.map(([key, binderRows]) => (
          <section className="docs-binder-group" key={key}>
            <h2 className="doc-rail-title">
              {binderRows[0]!.binder}
              <span className="doc-tab-count">{binderRows.length}</span>
            </h2>

            <div className="docs-list">
              {binderRows.map((row) => (
                <button
                  className="docs-list-item"
                  type="button"
                  key={row.key}
                  onClick={() =>
                    onSelectDocument(row.organization, row.binder, row.slugPath)
                  }
                >
                  <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span className="docs-list-item-body">
                    <span className="docs-list-item-name">{row.name}</span>
                    <span className="docs-list-item-meta">
                      {[
                        row.folder,
                        row.version,
                        getDocumentRowStatusLabel(row.status),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
