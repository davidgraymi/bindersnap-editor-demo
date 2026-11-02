import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";

import { homeChangesQuery, homeFeedQuery } from "../data/queries";
import { getGreeting, getGreetingName } from "../homeChanges";
import {
  describeFeedEvent,
  feedTime,
  groupFeedByDay,
  type FeedEvent,
} from "../homeFeed";
import { buildQueueRows, groupQueueRows } from "../reviewQueue";
import { followInApp } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { routeToPath } from "../routes";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonPanel } from "./Skeleton";

interface HomePageProps {
  currentUsername: string;
  currentUserFullName?: string;
  /** Open one change request — where an event about one leads. */
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  /** Open a binder — where an event about making one leads. */
  onOpenBinder: (org: string, binder: string) => void;
  /** The change requests page, where the work waiting on you is listed. */
  onOpenChanges: () => void;
  /** The organization's binders, where a document is added. */
  onOpenBinders: (() => void) | null;
  /** The getting-started guide, first thing on the page while it has steps left. */
  guide?: ReactNode;
}

/**
 * Home is what has been happening in your binders.
 *
 * It was a second list of change requests, beside the page that lists them —
 * the same rows, cut down. Now it is a feed, GitHub's dashboard for a policy
 * manual: who opened, approved, sent back, discussed, published or closed
 * what, a day at a time, newest first, as far back as you scroll. What is
 * waiting on your review is one line at the top that leads to the change
 * requests page, where every state has its place.
 *
 * The feed is Gitea's own (`/api/app/home/feed`), read with your token, so it
 * holds what you can see and nothing else.
 */
export function HomePage({
  currentUsername,
  currentUserFullName = "",
  onOpenChange,
  onOpenBinder,
  onOpenChanges,
  onOpenBinders,
  guide = null,
}: HomePageProps) {
  const feed = useInfiniteQuery(homeFeedQuery());
  const events = useMemo(
    () => feed.data?.pages.flatMap((page) => page.events) ?? [],
    [feed.data],
  );
  const days = useMemo(() => groupFeedByDay(events), [events]);

  // How many changes wait on your review: the same rule, from the same
  // payload, as the change requests page's first section.
  const home = useQuery(homeChangesQuery());
  const waiting = useMemo(
    () =>
      home.data
        ? groupQueueRows(buildQueueRows(home.data.open, currentUsername))
            .your_review.length
        : 0,
    [home.data, currentUsername],
  );

  const changesHref = routeToPath({ kind: "changes" });

  return (
    <div className="docw-page home-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">
            {getGreeting()},{" "}
            {getGreetingName(currentUsername, currentUserFullName)}.
          </h1>
          <p className="bs-subtitle">
            Here is what has been happening in your binders.
          </p>
        </div>
      </div>

      {guide}

      {/* The one thing on Home that is yours to do, as a way to it rather
          than a second copy of the list it leads to. */}
      {waiting > 0 ? (
        <a
          className="home-waiting"
          href={changesHref}
          onClick={(event) => followInApp(event, onOpenChanges)}
        >
          <span className="bs-section-count bs-section-count--attention">
            {waiting}
          </span>
          <span className="home-waiting-text">
            {waiting === 1
              ? "change request is waiting on your review"
              : "change requests are waiting on your review"}
          </span>
          <span className="home-waiting-go" aria-hidden="true">
            →
          </span>
        </a>
      ) : null}

      {feed.error ? (
        <section className="bs-panel">
          <div className="home-empty">
            <p>
              {feed.error.message || "Unable to read what has been happening."}
            </p>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              onClick={() => void feed.refetch()}
            >
              Try again
            </button>
          </div>
        </section>
      ) : feed.isPending ? (
        <SkeletonPanel label="Reading what has been happening" rows={4} bar />
      ) : events.length === 0 ? (
        <section className="bs-panel">
          <div className="home-empty">
            <p>
              Nothing has happened in your binders yet. When somebody proposes a
              change, approves one or publishes it, it shows up here.
            </p>
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
        <div className="home-feed">
          {days.map((day) => (
            <section
              key={day.label}
              className="home-feed-day"
              aria-label={day.label}
            >
              <h2 className="home-feed-day-label">{day.label}</h2>
              <ol className="bs-panel home-feed-list">
                {day.events.map((event) => (
                  <FeedItem
                    key={event.id}
                    event={event}
                    onOpenChange={onOpenChange}
                    onOpenBinder={onOpenBinder}
                  />
                ))}
              </ol>
            </section>
          ))}

          {feed.hasNextPage ? (
            <button
              type="button"
              className="bs-btn bs-btn-secondary home-feed-more"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              {feed.isFetchingNextPage ? "Reading further back…" : "Show older"}
            </button>
          ) : (
            <p className="home-feed-end">That is everything.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One event: who did what to which change, where, and when — with what they
 * wrote under it. The whole row is a link to the change, or to the binder for
 * a binder being made.
 */
function FeedItem({
  event,
  onOpenChange,
  onOpenBinder,
}: {
  event: FeedEvent;
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  onOpenBinder: (org: string, binder: string) => void;
}) {
  const line = describeFeedEvent(event);
  const change = event.changeNumber;
  const href =
    change === null
      ? buildBinderUrl({ org: event.org, binder: event.binder })
      : buildBinderUrl({
          org: event.org,
          binder: event.binder,
          tab: "changes",
          change,
        });

  return (
    <li className={`home-feed-item home-feed-item--${line.tone}`}>
      <a
        className="home-feed-link"
        href={href}
        onClick={(click) =>
          followInApp(click, () =>
            change === null
              ? onOpenBinder(event.org, event.binder)
              : onOpenChange(event.org, event.binder, change),
          )
        }
      >
        <PersonAvatar
          person={{ login: event.actor, fullName: event.actorName }}
          size="sm"
        />
        <span className="home-feed-body">
          <span className="home-feed-line">
            <strong className="home-feed-actor">{line.actor}</strong>{" "}
            {line.verb}{" "}
            <strong className="home-feed-subject">{line.subject}</strong>
            {line.binder ? (
              <span className="home-feed-where"> in {line.binder}</span>
            ) : null}
          </span>
          {event.excerpt ? (
            <span className="home-feed-excerpt">{event.excerpt}</span>
          ) : null}
        </span>
        <time className="home-feed-time" dateTime={event.createdAt}>
          {feedTime(event.createdAt)}
        </time>
      </a>
    </li>
  );
}
