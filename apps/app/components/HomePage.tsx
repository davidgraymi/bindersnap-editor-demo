import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";

import {
  homeChangesQuery,
  homeFeedQuery,
  myDraftsQuery,
} from "../data/queries";
import { getGreeting, getGreetingName } from "../homeChanges";
import {
  describeFeedEvent,
  describeOthers,
  feedTime,
  foldFeedDay,
  groupFeedByDay,
  type FeedGroup,
} from "../homeFeed";
import { buildHomeTasks, describeHomeTasks, type HomeTask } from "../homeTasks";
import { buildQueueRows } from "../reviewQueue";
import { followInApp, navigateToHref } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { routeToPath } from "../routes";
import { AppIcon, ICON } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonPanel } from "./Skeleton";

interface HomePageProps {
  currentUsername: string;
  currentUserFullName?: string;
  /** Open one change request — where an event about one leads. */
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  /** Open a binder — where an event about making one leads. */
  onOpenBinder: (org: string, binder: string) => void;
  /** The change requests page: every change in flight, yours or not. */
  onOpenChanges: () => void;
  /** The organization's binders, where a document is added. */
  onOpenBinders: (() => void) | null;
  /** The getting-started guide, first thing on the page while it has steps left. */
  guide?: ReactNode;
}

/**
 * Home is what is waiting on you, and then what has been happening.
 *
 * **Your turn first** (`homeTasks.ts`): the changes you were asked to
 * review, your own that were sent back or approved, and the drafts you have
 * not proposed, each with the one thing to do. It was a count that led to
 * the change requests page; the person this is for opens the app to find out
 * what they owe, and should not have to click to be told. That page still
 * lists every change in flight, by state, and is one link away.
 *
 * **Then the feed**, as far back as you scroll: who opened, approved, sent
 * back, discussed, published or closed what, a day at a time, each change
 * once a day (`foldFeedDay`). It is Gitea's own (`/api/app/home/feed`), read
 * with your token, so it holds what you can see and nothing else.
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

  // What is waiting on you: from the change requests page's own rows, so
  // the two cannot disagree, and from your drafts.
  const home = useQuery(homeChangesQuery());
  const drafts = useQuery(myDraftsQuery());
  const tasks = useMemo(
    () =>
      home.data
        ? buildHomeTasks(
            buildQueueRows(home.data.open, currentUsername),
            drafts.data?.drafts ?? [],
          )
        : null,
    [home.data, drafts.data, currentUsername],
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
            {tasks === null
              ? home.error
                ? "Here is what has been happening in your binders."
                : "Checking what is waiting on you…"
              : describeHomeTasks(tasks.length)}
          </p>
        </div>
      </div>

      {guide}

      {/* Your turn. Kept on the page when it is empty: "nothing is waiting
          on you" is the answer most visits are for. */}
      {tasks === null ? (
        home.error ? null : (
          <SkeletonPanel label="Checking what is waiting on you" rows={2} bar />
        )
      ) : (
        <section className="bs-panel home-tasks" aria-labelledby="home-tasks">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title" id="home-tasks">
              Your turn
            </h2>
            <span
              className={`bs-section-count${
                tasks.length > 0 ? " bs-section-count--attention" : ""
              }`}
            >
              {tasks.length}
            </span>
            <a
              className="home-tasks-all"
              href={changesHref}
              onClick={(event) => followInApp(event, onOpenChanges)}
            >
              All change requests
            </a>
          </div>
          {tasks.length === 0 ? (
            <p className="home-tasks-empty">
              You are up to date. When somebody asks for your review, or a
              change of yours is sent back or approved, it is listed here.
            </p>
          ) : (
            <ul className="bs-row-list">
              {tasks.map((task) => (
                <TaskRow key={task.key} task={task} />
              ))}
            </ul>
          )}
        </section>
      )}

      <h2 className="home-section-title">Lately in your binders</h2>

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
              <h3 className="home-feed-day-label">{day.label}</h3>
              <ol className="bs-panel home-feed-list">
                {foldFeedDay(day.events).map((group) => (
                  <FeedItem
                    key={group.lead.id}
                    group={group}
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
 * One thing waiting on you: what it is, why it is yours, and what to do.
 *
 * The whole row is a link, as every list's is. The word on the right is the
 * act, not a button: approving and publishing are decided on the change's
 * own page, with what they do in front of you.
 */
function TaskRow({ task }: { task: HomeTask }) {
  return (
    <li className="bs-row home-task">
      <a
        className="home-task-link"
        href={task.href}
        onClick={(event) => followInApp(event, () => navigateToHref(task.href))}
      >
        <span className="bs-row-icon" aria-hidden="true">
          <AppIcon
            icon={task.kind === "draft" ? ICON.draft : ICON.changeRequest}
            size="md"
          />
        </span>
        <span className="home-task-body">
          <span className="bs-row-name home-task-title">{task.title}</span>
          <span className="bs-row-meta">{task.detail}</span>
        </span>
        <span className="home-task-action">
          {task.action}
          <AppIcon icon={ICON.forward} size="sm" />
        </span>
      </a>
    </li>
  );
}

/**
 * One change's day: who did what to it, where, and when — with what they
 * wrote under it, and how much else happened. The whole row is a link to the
 * change, or to the binder for a binder being made.
 */
function FeedItem({
  group,
  onOpenChange,
  onOpenBinder,
}: {
  group: FeedGroup;
  onOpenChange: (owner: string, repo: string, changeNumber: number) => void;
  onOpenBinder: (org: string, binder: string) => void;
}) {
  const event = group.lead;
  const line = describeFeedEvent(event);
  const others = describeOthers(group.others);
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
            {others ? (
              <span className="home-feed-others"> · {others}</span>
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
