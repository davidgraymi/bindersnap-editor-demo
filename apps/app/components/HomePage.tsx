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
import { ChangeRowView } from "./ChangeRow";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface HomePageProps {
  currentUsername: string;
  currentUserFullName?: string;
  /** Open one change request — the only thing a row on this page links to. */
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  onBrowseDocuments: () => void;
  onNewDocument: () => void;
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
  onNewDocument,
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

  return (
    <div className="home-page">
      <h1 className="home-greeting">
        {getGreeting()}, {getGreetingName(currentUsername, currentUserFullName)}
        .
      </h1>
      <p className="home-subtitle">
        {isLoading
          ? "Gathering the change requests you are part of."
          : describeWaitingCount(waitingOnYou.length)}
      </p>

      {error ? (
        <section className="bs-panel home-section">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Something went wrong</h2>
          </div>
          <div className="home-empty">
            <p>{error}</p>
            <button
              type="button"
              className="home-row-action"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        </section>
      ) : isLoading ? (
        <section className="bs-panel home-section">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Waiting on you</h2>
          </div>
          <HomeSkeletonRows count={2} />
        </section>
      ) : !hasAnything ? (
        <section className="bs-panel home-section">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Waiting on you</h2>
            <span className="bs-panel-bar-spacer" />
            <button
              type="button"
              className="home-section-link"
              onClick={onBrowseDocuments}
            >
              Browse documents →
            </button>
          </div>
          <div className="home-empty">
            <p>
              No change requests yet. Submit a new version of a document and it
              will show up here the moment someone has to look at it.
            </p>
            <button
              type="button"
              className="home-row-action"
              onClick={onNewDocument}
            >
              Add a document
            </button>
          </div>
        </section>
      ) : (
        <>
          {waitingOnYou.length > 0 ? (
            <section className="bs-panel home-section">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">Waiting on you</h2>
                <span className="home-section-count">
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
            <section className="bs-panel home-section">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">Your submissions</h2>
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

          <section className="bs-panel home-section">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title">Recently decided</h2>
              <span className="bs-panel-bar-spacer" />
              <button
                type="button"
                className="home-section-link"
                onClick={onBrowseDocuments}
              >
                Browse documents →
              </button>
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

function HomeSkeletonRows({ count }: { count: number }) {
  return (
    <SkeletonGroup label="Loading your change requests">
      {Array.from({ length: count }, (_, index) => (
        <div className="home-row home-row--skeleton" key={index}>
          <div className="home-row-icon home-row-icon--quiet" />
          <span className="bs-skeleton-lines">
            <SkeletonLine width="medium" />
            <SkeletonLine width="short" />
          </span>
        </div>
      ))}
    </SkeletonGroup>
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
      onOpen={() => onOpen(row.owner, row.repo, row.number)}
    />
  );
}
