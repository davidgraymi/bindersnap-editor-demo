import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText } from "lucide-react";

import { fetchLibrary, type LibraryPayload } from "../api";
import {
  applyBinderFilter,
  describeBinderHeading,
  describeFolder,
  getDocumentRowTone,
  spansOrganizations,
  binderKey,
  buildDocumentRows,
  buildDocumentsUrl,
  describeDocumentCount,
  getDocumentRowStatusLabel,
  parseDocumentsViewState,
  type DocumentsViewState,
} from "../documentsView";
import { followInApp } from "../appLink";
import { buildDocumentUrl } from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface DocumentsPageProps {
  onSelectDocument: (org: string, binder: string, slugPath: string) => void;
  /** Open a binder, from the heading of its group. */
  onOpenBinder: (org: string, binder: string) => void;
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
export function DocumentsPage({
  onSelectDocument,
  onOpenBinder,
}: DocumentsPageProps) {
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
            : "Unable to load your documents.",
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

  const manyOrganizations = spansOrganizations(library?.binders ?? []);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  return (
    <section className="docs-page">
      {/* Named for the entry that opens it. It was "Policies" while the
          navigation said "Documents", so the page a reader arrived at was not
          the page they had clicked. */}
      <h1 className="docs-title">Documents</h1>
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
          placeholder="Search documents"
          aria-label="Search documents"
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
                {describeBinderHeading(
                  { organization: binder.organization, binder: binder.name },
                  manyOrganizations,
                )}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {library === null ? (
        <SkeletonGroup label="Reading your documents">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      ) : rows.length === 0 ? (
        <p className="doc-rail-note">
          {state.freeText
            ? `Nothing matches “${state.freeText}”.`
            : library.binders.length === 0
              ? "You are not in a binder yet. A document is filed in one, so a binder comes first."
              : "None of your binders holds a document yet."}
        </p>
      ) : (
        grouped.map(([key, binderRows]) => {
          const first = binderRows[0]!;
          const heading = describeBinderHeading(first, manyOrganizations);

          /* **The same panel every other list is drawn in**, the way a code
             host draws a project's files: a bar that names the binder and
             counts what is in it, then one row per document. It was a
             letter-spaced label over a stack of 80px cards — the only list in
             the app shaped like that, and one where a page of twelve policies
             was two screens of scrolling. */
          return (
            <section
              className="bs-panel docs-binder-group"
              key={key}
              aria-label={heading}
            >
              <div className="bs-panel-bar">
                {/* The heading is the way into the binder, the way a group's
                    name is on GitLab: a reader who found the policy usually
                    wants the rest of its binder next. */}
                <h2 className="bs-panel-bar-title">
                  <a
                    className="docs-binder-link"
                    href={buildBinderUrl({
                      org: first.organization,
                      binder: first.binder,
                    })}
                    onClick={(event) =>
                      followInApp(event, () =>
                        onOpenBinder(first.organization, first.binder),
                      )
                    }
                  >
                    <BookOpen size={15} strokeWidth={1.6} aria-hidden="true" />
                    {heading}
                  </a>
                </h2>
                <span className="bs-panel-bar-spacer" />
                <span className="binder-count">
                  {describeDocumentCount(binderRows.length)}
                </span>
              </div>

              <ul className="bs-row-list">
                {binderRows.map((row) => (
                  <li key={row.key}>
                    <a
                      className="bs-row docs-row"
                      href={buildDocumentUrl({
                        org: row.organization,
                        binder: row.binder,
                        documentPath: row.slugPath,
                        version: null,
                      })}
                      onClick={(event) =>
                        followInApp(event, () =>
                          onSelectDocument(
                            row.organization,
                            row.binder,
                            row.slugPath,
                          ),
                        )
                      }
                    >
                      <span className="bs-row-icon">
                        <FileText
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="bs-row-body">
                        <span className="bs-row-name">{row.name}</span>
                        {row.folder ? (
                          <span className="bs-row-meta">
                            {describeFolder(row.folder)}
                          </span>
                        ) : null}
                      </span>
                      {/* **Columns, not a sentence.** The version and the
                          status were run together into the line under the
                          name — "nursing · v3 · Published" — so reading down
                          the list for the one still in review meant reading
                          every row. They are columns now, in the same place
                          on every row, and the status is the same dot and
                          word a change request's is. */}
                      <span className="bs-row-right">
                        <span className="bs-ver docs-row-version">
                          {row.version}
                        </span>
                        <span
                          className={`change-standing change-standing--${getDocumentRowTone(
                            row.status,
                          )}`}
                        >
                          <span
                            className="change-standing-dot"
                            aria-hidden="true"
                          />
                          {getDocumentRowStatusLabel(row.status)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}
