import { useCallback, useEffect, useState } from "react";
import { ArrowRightToLine, Check, Clock, X } from "lucide-react";

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
        <section className="home-section">
          <div className="home-section-head">
            <span className="home-section-label">Something went wrong</span>
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
        <section className="home-section">
          <div className="home-section-head">
            <span className="home-section-label">Waiting on you</span>
          </div>
          <HomeSkeletonRows count={2} />
        </section>
      ) : !hasAnything ? (
        <section className="home-section">
          <div className="home-section-head">
            <span className="home-section-label">Waiting on you</span>
            <span className="home-section-spacer" />
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
              New document
            </button>
          </div>
        </section>
      ) : (
        <>
          {waitingOnYou.length > 0 ? (
            <section className="home-section">
              <div className="home-section-head">
                <span className="home-section-label home-section-label--urgent">
                  Waiting on you
                </span>
                <span className="home-section-count">
                  {waitingOnYou.length}
                </span>
              </div>
              {waitingOnYou.map((row) => (
                <HomeChangeRowItem
                  key={row.key}
                  row={row}
                  onOpen={onOpenChange}
                />
              ))}
            </section>
          ) : null}

          {submissions.length > 0 ? (
            <section className="home-section">
              <div className="home-section-head">
                <span className="home-section-label">Your submissions</span>
              </div>
              {submissions.map((row) => (
                <HomeChangeRowItem
                  key={row.key}
                  row={row}
                  onOpen={onOpenChange}
                />
              ))}
            </section>
          ) : null}

          <section className="home-section">
            <div className="home-section-head">
              <span className="home-section-label">Recently decided</span>
              <span className="home-section-spacer" />
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
              decided.map((row) => (
                <HomeDecidedRowItem
                  key={row.key}
                  row={row}
                  onOpen={onOpenChange}
                />
              ))
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

function HomeChangeRowItem({
  row,
  onOpen,
}: {
  row: HomeChangeRow;
  onOpen: (owner: string, repo: string, changeNumber: number) => void;
}) {
  const open = () => onOpen(row.owner, row.repo, row.number);

  return (
    <div
      className="home-row"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <span
        className={`home-row-icon home-row-icon--${row.kind === "needs_review" ? "urgent" : row.kind === "ready_to_publish" ? "done" : "quiet"}`}
        aria-hidden="true"
      >
        {row.kind === "needs_review" ? (
          <ArrowRightToLine size={16} strokeWidth={1.5} />
        ) : row.kind === "ready_to_publish" ? (
          <Check size={16} strokeWidth={1.6} />
        ) : (
          <Clock size={16} strokeWidth={1.4} />
        )}
      </span>

      <span className="home-row-body">
        <span className="home-row-title">{row.title}</span>
        <span className="home-row-meta">
          <span className="home-row-docref">{row.documentName}</span> ·{" "}
          {row.meta}
        </span>
      </span>

      <span
        className={`home-pill home-pill--${row.kind === "needs_review" ? "review" : row.kind === "ready_to_publish" ? "approved" : "waiting"}`}
      >
        {row.pillLabel}
      </span>

      {row.action ? (
        <button
          type="button"
          className="home-row-action"
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
        >
          {row.action}
        </button>
      ) : null}
    </div>
  );
}

function HomeDecidedRowItem({
  row,
  onOpen,
}: {
  row: HomeDecidedRow;
  onOpen: (owner: string, repo: string, changeNumber: number) => void;
}) {
  const open = () => onOpen(row.owner, row.repo, row.number);

  return (
    <div
      className="home-row"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <span
        className={`home-row-icon home-row-icon--${row.outcome === "published" ? "done" : "quiet"}`}
        aria-hidden="true"
      >
        {row.outcome === "published" ? (
          <Check size={16} strokeWidth={1.6} />
        ) : (
          <X size={16} strokeWidth={1.5} />
        )}
      </span>

      <span className="home-row-body">
        <span className="home-row-title">{row.title}</span>
        <span className="home-row-meta">
          <span className="home-row-docref">{row.documentName}</span> ·{" "}
          {row.meta}
        </span>
      </span>

      <span
        className={`home-pill home-pill--${row.outcome === "published" ? "approved" : "waiting"}`}
      >
        {row.pillLabel}
      </span>
    </div>
  );
}
