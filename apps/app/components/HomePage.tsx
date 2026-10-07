import { useCallback, useEffect, useState } from "react";

import { getHomeChanges, type HomeOpenDocument } from "../api";
import {
  buildDecidedChangeRows,
  buildOpenChangeRows,
  describeWaitingCount,
  getGreeting,
  getGreetingName,
  selectSubmissions,
  selectWaitingOnYou,
  type HomeChangeRow,
  type HomeDecidedRow,
} from "../homeChanges";
import { followInApp } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { routeToPath } from "../routes";
import { ChangeRowView } from "./ChangeRow";
import { SkeletonPanel } from "./Skeleton";

interface HomePageProps {
  currentUsername: string;
  currentUserFullName?: string;
  /** Open one change request — the only thing a row on this page links to. */
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  onBrowseDocuments: () => void;
  /** The organization's binders, where a document is added. */
  onOpenBinders: (() => void) | null;
}

/**
 * Home is the reader's queue of change requests.
 *
 * Every row is a change they are part of — never a document link. The only
 * path from here into the library is the "Browse documents" link, because a
 * list of documents answers a question nobody arrives with.
 */
export function HomePage({
  currentUsername,
  currentUserFullName = "",
  onOpenChange,
  onBrowseDocuments,
  onOpenBinders,
}: HomePageProps) {
  const [documents, setDocuments] = useState<HomeOpenDocument[]>([]);
  const [decided, setDecided] = useState<HomeDecidedRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // One request. Home is a query — "the changes I am part of" — and the
      // server answers it against every document at once, so the page no
      // longer walks the workspace or asks each document for its own history.
      const { open, decided: decidedDocuments } = await getHomeChanges();
      setDocuments(open);

      const ownedRepos = new Set(
        [
          ...open.map((document) => ({
            owner: document.repo.owner.login,
            repo: document.repo.name,
          })),
          ...decidedDocuments.map((document) => ({
            owner: document.owner,
            repo: document.repo,
          })),
        ]
          .filter((ref) => ref.owner === currentUsername)
          .map((ref) => `${ref.owner}/${ref.repo}`),
      );

      setDecided(
        buildDecidedChangeRows(decidedDocuments, currentUsername, ownedRepos),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your change requests.",
      );
      setDocuments([]);
      setDecided([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentUsername]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRows = buildOpenChangeRows(documents, currentUsername);
  const waitingOnYou = selectWaitingOnYou(openRows);
  const submissions = selectSubmissions(openRows);
  const hasAnything =
    waitingOnYou.length > 0 || submissions.length > 0 || decided.length > 0;

  // "Browse documents" is a place, so it is a link: it opens in a new tab and
  // shows where it goes, which a button that moved the address bar did not.
  const browseLink = (
    <a
      className="home-section-link"
      href={routeToPath({ kind: "documents" })}
      onClick={(event) => followInApp(event, onBrowseDocuments)}
    >
      Browse documents →
    </a>
  );

  return (
    <div className="docw-page home-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">
            {getGreeting()},{" "}
            {getGreetingName(currentUsername, currentUserFullName)}.
          </h1>
          <p className="bs-subtitle">
            {isLoading
              ? "Gathering the change requests you are part of."
              : describeWaitingCount(waitingOnYou.length)}
          </p>
        </div>
      </div>

      {error ? (
        <section className="bs-panel">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Something went wrong</h2>
          </div>
          <div className="home-empty">
            <p>{error}</p>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        </section>
      ) : isLoading ? (
        <SkeletonPanel
          label="Loading your change requests"
          rows={3}
          bar
          right
        />
      ) : !hasAnything ? (
        <section className="bs-panel">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Waiting on you</h2>
            <span className="bs-panel-bar-spacer" />
            {browseLink}
          </div>
          <div className="home-empty">
            <p>
              No change requests yet. Submit a new version of a document and it
              will show up here the moment someone has to look at it.
            </p>
            {/* A document is added on its binder's page, where the binder and
                its rules are already on screen. */}
            {onOpenBinders ? (
              <button
                type="button"
                className="bs-btn bs-btn-secondary bs-btn--sm"
                onClick={onOpenBinders}
              >
                Open your binders
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          {waitingOnYou.length > 0 ? (
            <section className="bs-panel">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">Waiting on you</h2>
                <span className="bs-section-count bs-section-count--attention">
                  {waitingOnYou.length}
                </span>
              </div>
              <ul className="bs-row-list">
                {waitingOnYou.map((row) => (
                  <HomeChangeRowItem
                    key={row.key}
                    row={row}
                    onOpen={onOpenChange}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {submissions.length > 0 ? (
            <section className="bs-panel">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">Your submissions</h2>
                {/* Counted like the section above it, in the quiet colour:
                    these are waiting on somebody else, not on you. */}
                <span className="bs-section-count">{submissions.length}</span>
              </div>
              <ul className="bs-row-list">
                {submissions.map((row) => (
                  <HomeChangeRowItem
                    key={row.key}
                    row={row}
                    onOpen={onOpenChange}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="bs-panel">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title">Recently decided</h2>
              <span className="bs-panel-bar-spacer" />
              {browseLink}
            </div>
            {decided.length === 0 ? (
              <div className="home-empty">
                <p>Nothing has been decided yet.</p>
              </div>
            ) : (
              <ul className="bs-row-list">
                {decided.map((row) => (
                  <HomeDecidedRowItem
                    key={row.key}
                    row={row}
                    onOpen={onOpenChange}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * One change request on Home — the same row every other list draws.
 *
 * Home used to draw its own: a tinted icon tile, the document in bold, and a
 * Review button that did exactly what clicking the row did. Three lists, three
 * rows, one object. What Home knows that the others do not is which document
 * the change is about and whose turn it is; the first leads the meta line, the
 * second is the section the row is in.
 */
/** Where a row on Home goes: the change, on its binder. */
function changeHref(row: { owner: string; repo: string; number: number }) {
  return buildBinderUrl({
    org: row.owner,
    binder: row.repo,
    tab: "changes",
    change: row.number,
  });
}

function HomeChangeRowItem({
  row,
  onOpen,
}: {
  row: HomeChangeRow;
  onOpen: (owner: string, repo: string, changeNumber: number) => void;
}) {
  return (
    <ChangeRowView
      title={row.title}
      context={row.documentName}
      meta={row.meta}
      tone={row.tone}
      standing={row.standing}
      commentCount={row.commentCount}
      href={changeHref(row)}
      onOpen={() => onOpen(row.owner, row.repo, row.number)}
    />
  );
}

function HomeDecidedRowItem({
  row,
  onOpen,
}: {
  row: HomeDecidedRow;
  onOpen: (owner: string, repo: string, changeNumber: number) => void;
}) {
  return (
    <ChangeRowView
      title={row.title}
      context={row.documentName}
      meta={row.meta}
      tone={row.tone}
      standing={row.standing}
      outcome={row.outcome === "published" ? "published" : "declined"}
      href={changeHref(row)}
      onOpen={() => onOpen(row.owner, row.repo, row.number)}
    />
  );
}
