import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRightToLine,
  Check,
  MessageSquare,
  Pencil,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";

import type { ChangeUpdate, DiscussionSummary, ReactionKind } from "../api";
import type { ChangeScope } from "../changeScope";
import {
  createChangeDiscussion,
  listChangeDiscussions,
  replyToChangeDiscussion,
  resolveChangeDiscussion,
  setDiscussionCommentReaction,
} from "../api";
import { applyReactionLocally } from "../reactions";
import type { TimelineEntry, TimelineEntryKind } from "../changeReview";
import { buildReviewTimeline } from "../changeReview";
import type { ChangeRecord } from "../documentDisplay";
import { ReviewThread } from "./ReviewThread";
import { SkeletonGroup, SkeletonLine, SkeletonShape } from "./Skeleton";

interface ReviewTimelineProps {
  /** Which repository this change lives in — a document's, or a binder. */
  scope: ChangeScope;
  change: ChangeRecord;
  /** Every version this change has proposed, for the update events. */
  updates: ChangeUpdate[];
  /** Whether an update wipes earlier approvals, per branch protection. */
  resetsApprovals: boolean;
  canParticipate: boolean;
  /** Whose reactions read as "You". Empty for a signed-out reader. */
  currentUsername: string;
  blockOnUnresolvedThreads: boolean;
  /** Lets the page re-render its publish gate when the unresolved count moves. */
  onSummaryChange?: (summary: DiscussionSummary) => void;
  /** Open one update's file. Null when the file cannot be shown. */
  onOpenUpdate: ((sha: string) => void) | null;
}

const ENTRY_ICONS: Record<TimelineEntryKind, typeof Check> = {
  opened: ArrowRightToLine,
  thread: MessageSquare,
  update: RefreshCw,
  approved: Check,
  changes: X,
  commented: MessageSquare,
  closed: Undo2,
};

/** One row of plain text on the paper: something happened, and this is it. */
function TimelineEvent({
  entry,
  onOpenUpdate,
}: {
  entry: TimelineEntry;
  onOpenUpdate: ((sha: string) => void) | null;
}) {
  const event = entry.event;
  if (!event) return null;

  return (
    <p className="rev-event">
      {event.actor ? (
        <strong className="rev-event-actor">{event.actor}</strong>
      ) : null}{" "}
      <span
        className={
          event.emphasiseVerb
            ? "rev-event-verb rev-event-verb--good"
            : undefined
        }
      >
        {event.verb}
      </span>
      {event.tag ? <span className="rev-event-tag">{event.tag}</span> : null}
      {event.when ? (
        <span className="rev-event-when"> · {event.when}</span>
      ) : null}
      {event.note ? (
        <span className="rev-event-note"> · {event.note}</span>
      ) : null}
      {event.updateSha && onOpenUpdate ? (
        <>
          {" · "}
          <button
            className="rev-link"
            type="button"
            onClick={() => onOpenUpdate(event.updateSha!)}
          >
            view this update
          </button>
        </>
      ) : null}
    </p>
  );
}

/**
 * Everything that has happened to this change, on one spine.
 *
 * The spine is a hairline on the page rather than a box around a list: the
 * change's history is the page, and a border around it would say it was one
 * more panel among several. Comments are white cards because somebody wrote
 * them and they can be answered; events — opened, updated, approved — are
 * plain rows on the paper, because there is nothing to do with them but read
 * them. The dots are fully opaque so the hairline never shows through one.
 */
export function ReviewTimeline({
  scope,
  change,
  updates,
  resetsApprovals,
  canParticipate,
  currentUsername,
  blockOnUnresolvedThreads,
  onSummaryChange,
  onOpenUpdate,
}: ReviewTimelineProps) {
  const [summary, setSummary] = useState<DiscussionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newThreadBody, setNewThreadBody] = useState("");
  const [composing, setComposing] = useState(false);

  const pullNumber = change.number;

  // Held in a ref so `apply` stays referentially stable. Callers pass an
  // inline arrow, and letting that identity reach the load effect's
  // dependencies would refetch the discussion on every parent render.
  const onSummaryChangeRef = useRef(onSummaryChange);
  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange;
  }, [onSummaryChange]);

  const apply = useCallback((next: DiscussionSummary) => {
    setSummary(next);
    onSummaryChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const next = await listChangeDiscussions(scope, pullNumber);
        if (!cancelled) {
          apply(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load the discussion.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [scope, pullNumber, apply]);

  async function run(
    action: () => Promise<DiscussionSummary>,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Move the chip first, then tell the server.
   *
   * A reaction is the cheapest thing on this page and the round trip is not.
   * Waiting on the network to draw a "+1" makes the control feel broken, so
   * the count moves immediately and the server's answer — which is the whole
   * discussion — overwrites it either way. A failure puts the count back and
   * says why.
   */
  function react(
    threadId: string,
    commentId: number,
    content: ReactionKind,
    on: boolean,
  ): void {
    const before = summary;
    if (!before) return;

    apply(
      reactLocally(before, threadId, commentId, content, on, currentUsername),
    );
    setError(null);

    void setDiscussionCommentReaction(
      scope,
      pullNumber,
      threadId,
      commentId,
      content,
      on,
    )
      .then(apply)
      .catch((err: unknown) => {
        apply(before);
        setError(
          err instanceof Error ? err.message : "Unable to save the reaction.",
        );
      });
  }

  async function startThread() {
    const body = newThreadBody.trim();
    if (!body) return;
    const posted = await run(() =>
      createChangeDiscussion(scope, pullNumber, body),
    );
    if (!posted) return;
    setNewThreadBody("");
    setComposing(false);
  }

  const entries = buildReviewTimeline({
    change,
    threads: summary?.threads ?? [],
    updates,
    resetsApprovals,
  });
  const unresolved = summary?.unresolvedCount ?? 0;

  return (
    <section className="rev-timeline-wrap" aria-label="Change history">
      {blockOnUnresolvedThreads && unresolved > 0 ? (
        <p className="rev-gate" role="status">
          This version cannot be published until every thread is resolved.
        </p>
      ) : null}

      <div className="rev-timeline">
        {entries.map((entry) => {
          const Icon = ENTRY_ICONS[entry.kind];
          const green = entry.kind === "approved" || isPublished(entry, change);

          return (
            <div className="rev-entry" key={entry.key}>
              <span
                className={`rev-dot${green ? " rev-dot--green" : ""}`}
                aria-hidden="true"
              >
                <Icon size={13} strokeWidth={1.75} />
              </span>
              {entry.thread ? (
                <ReviewThread
                  thread={entry.thread}
                  canParticipate={canParticipate}
                  busy={busy}
                  currentUsername={currentUsername}
                  onReact={react}
                  onReply={(threadId, body) =>
                    run(() =>
                      replyToChangeDiscussion(
                        scope,
                        pullNumber,
                        threadId,
                        body,
                      ),
                    )
                  }
                  onToggleResolved={async (threadId, resolved) => {
                    await run(() =>
                      resolveChangeDiscussion(
                        scope,
                        pullNumber,
                        threadId,
                        resolved,
                      ),
                    );
                  }}
                />
              ) : (
                <TimelineEvent entry={entry} onOpenUpdate={onOpenUpdate} />
              )}
            </div>
          );
        })}

        {loading ? (
          <SkeletonGroup label="Loading the discussion">
            {Array.from({ length: 2 }, (_, index) => (
              <div className="rev-entry" key={index}>
                <SkeletonShape variant="avatar" />
                <span className="bs-skeleton-lines">
                  <SkeletonLine width="medium" />
                  <SkeletonLine width="wide" />
                </span>
              </div>
            ))}
          </SkeletonGroup>
        ) : null}

        {canParticipate ? (
          <div className="rev-entry">
            <span className="rev-dot" aria-hidden="true">
              <Pencil size={12} strokeWidth={1.75} />
            </span>
            {composing ? (
              <div className="rev-composer">
                <textarea
                  className="rev-composer-input"
                  rows={3}
                  autoFocus
                  placeholder="Raise a concern about this version…"
                  value={newThreadBody}
                  onChange={(event) => setNewThreadBody(event.target.value)}
                />
                <div className="rev-composer-actions">
                  <button
                    className="rev-btn rev-btn--ghost"
                    type="button"
                    disabled={busy || !newThreadBody.trim()}
                    onClick={() => void startThread()}
                  >
                    {busy ? "Posting…" : "Comment"}
                  </button>
                  <button
                    className="rev-link"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setComposing(false);
                      setNewThreadBody("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="rev-composer-stub"
                type="button"
                onClick={() => setComposing(true)}
              >
                Add a comment…
              </button>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="vault-pr-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Publishing is the one closing event that earns the green dot. */
function isPublished(entry: TimelineEntry, change: ChangeRecord): boolean {
  return entry.kind === "closed" && change.outcome === "published";
}

/**
 * The same summary with one reaction moved, for the moment before the server
 * answers. Copies down to the comment that changed and leaves the rest of the
 * record alone.
 */
function reactLocally(
  summary: DiscussionSummary,
  threadId: string,
  commentId: number,
  content: ReactionKind,
  on: boolean,
  currentUsername: string,
): DiscussionSummary {
  return {
    ...summary,
    threads: summary.threads.map((thread) =>
      thread.id !== threadId
        ? thread
        : {
            ...thread,
            comments: thread.comments.map((comment) =>
              comment.id !== commentId
                ? comment
                : {
                    ...comment,
                    reactions: applyReactionLocally(
                      comment.reactions,
                      content,
                      on,
                      { login: currentUsername, fullName: "" },
                    ),
                  },
            ),
          },
    ),
  };
}
