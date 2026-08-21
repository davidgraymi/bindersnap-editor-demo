import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, GitMerge, MessageSquare, Undo2, X } from "lucide-react";

import {
  createDocumentDiscussion,
  listDocumentDiscussions,
  replyToDocumentDiscussion,
  resolveDocumentDiscussion,
  type DiscussionSummary,
  type DiscussionThread,
  type VersionReview,
} from "../api";

/** How the change ended, as one last entry in the log. */
export interface ClosingEvent {
  kind: "published" | "declined" | "withdrawn";
  actor: string | null;
  at: string | null;
  publishedVersion: number | null;
}

interface ReviewDiscussionProps {
  owner: string;
  repo: string;
  pullNumber: number;
  /** The submitter's own words, pinned to the top as the opening post. */
  opening: {
    author: string;
    at: string;
    body: string;
  };
  /** Every review on this change: approvals, rejections, plain comments. */
  reviews: VersionReview[];
  /** Set once the change is closed, so the log ends where the change did. */
  closing: ClosingEvent | null;
  /** Whether the current user may post and resolve. Read-only viewers get the record without the controls. */
  canParticipate: boolean;
  /** Publication is gated on unresolved threads for this document. */
  blockOnUnresolvedThreads: boolean;
  /** Lets the parent re-render its publish gate when the unresolved count moves. */
  onSummaryChange?: (summary: DiscussionSummary) => void;
}

function formatTimestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function displayName(author: { login: string; fullName: string }): string {
  return author.fullName?.trim() || author.login;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function Avatar({
  author,
}: {
  author: { login: string; fullName: string; avatarUrl: string };
}) {
  const name = displayName(author);

  if (author.avatarUrl) {
    return (
      <img
        className="discussion-avatar"
        src={author.avatarUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="discussion-avatar discussion-avatar-fallback"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** The submitter's own words, and the reason the change exists. */
function OpeningPost({
  author,
  at,
  body,
}: {
  author: string;
  at: string;
  body: string;
}) {
  return (
    <article className="discussion-opening">
      <span
        className="discussion-avatar discussion-avatar-fallback"
        aria-hidden="true"
      >
        {initials(author)}
      </span>
      <div className="discussion-opening-main">
        <div className="discussion-comment-meta">
          <span className="discussion-comment-author">
            {capitalize(author) || "Someone"}
          </span>
          <span className="discussion-comment-time">
            submitted this change{at ? ` · ${formatTimestamp(at)}` : ""}
          </span>
        </div>
        <div className="discussion-comment-body">
          {body || <em>No description was given.</em>}
        </div>
      </div>
    </article>
  );
}

function reviewSentence(review: VersionReview): string {
  switch (review.state) {
    case "approved":
      return "approved this change";
    case "changes_requested":
      return "requested changes";
    default:
      return "commented";
  }
}

/**
 * A decision, in the log, at the moment it happened.
 *
 * An approval is not metadata on a badge somewhere — it is an event with an
 * author and a timestamp, and it belongs in the same column as everything
 * else that happened to this change.
 */
function ReviewEvent({ review }: { review: VersionReview }) {
  const name = displayName(review.author);
  const tone =
    review.state === "approved"
      ? "approved"
      : review.state === "changes_requested"
        ? "changes"
        : "comment";
  const Icon =
    review.state === "approved"
      ? Check
      : review.state === "changes_requested"
        ? X
        : MessageSquare;

  return (
    <article className={`discussion-event discussion-event--${tone}`}>
      <span className="discussion-event-icon" aria-hidden="true">
        <Icon size={13} strokeWidth={2} />
      </span>
      <div className="discussion-event-main">
        <p className="discussion-event-line">
          <span className="discussion-comment-author">{name}</span>{" "}
          {reviewSentence(review)}
          {review.dismissed ? (
            <span className="discussion-event-note"> — later dismissed</span>
          ) : review.stale ? (
            <span className="discussion-event-note">
              {" "}
              — superseded by a later upload
            </span>
          ) : null}
          <span className="discussion-comment-time">
            {review.submittedAt
              ? ` · ${formatTimestamp(review.submittedAt)}`
              : ""}
          </span>
        </p>
        {review.body.trim() ? (
          <div className="discussion-comment-body">{review.body}</div>
        ) : null}
      </div>
    </article>
  );
}

/** The last line of the log: what became of the change. */
function ClosingEventRow({ event }: { event: ClosingEvent }) {
  const actor = event.actor ? capitalize(event.actor) : null;
  const when = event.at ? formatTimestamp(event.at) : null;
  const Icon = event.kind === "published" ? GitMerge : Undo2;

  const line =
    event.kind === "published"
      ? `${actor ?? "Someone"} published this${
          event.publishedVersion === null
            ? ""
            : ` as v${event.publishedVersion}`
        }`
      : event.kind === "declined"
        ? "This change was closed without being published"
        : "This change was withdrawn";

  return (
    <article
      className={`discussion-event discussion-event--${event.kind === "published" ? "approved" : "closed"}`}
    >
      <span className="discussion-event-icon" aria-hidden="true">
        <Icon size={13} strokeWidth={2} />
      </span>
      <div className="discussion-event-main">
        <p className="discussion-event-line">
          {line}
          <span className="discussion-comment-time">
            {when ? ` · ${when}` : ""}
          </span>
        </p>
      </div>
    </article>
  );
}

/**
 * One review thread, rendered the way GitHub and GitLab render theirs: the
 * root comment, its replies in order, a resolution banner, and a reply box
 * that is already open — replying should cost a sentence, not a click first.
 */
function Thread({
  thread,
  canParticipate,
  onReply,
  onToggleResolved,
  busy,
}: {
  thread: DiscussionThread;
  canParticipate: boolean;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  busy: boolean;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [collapsed, setCollapsed] = useState(thread.resolved);

  // Resolved threads collapse by default, but never fight a user who has
  // deliberately expanded one to read it.
  useEffect(() => {
    setCollapsed(thread.resolved);
  }, [thread.resolved]);

  const isExternal = thread.origin === "external";
  const canAct = canParticipate && !isExternal;

  async function submitReply() {
    const body = replyBody.trim();
    if (!body) return;
    // Keep the draft when the post fails, so an error never costs the user
    // the text they wrote.
    const posted = await onReply(thread.id, body);
    if (!posted) return;
    setReplyBody("");
  }

  return (
    <article
      className={`discussion-thread${thread.resolved ? " discussion-thread-resolved" : ""}`}
      data-testid="discussion-thread"
    >
      <header className="discussion-thread-header">
        <span
          className={`discussion-thread-status${
            thread.resolved ? " discussion-thread-status-resolved" : ""
          }`}
        >
          {thread.resolved ? "Resolved" : "Unresolved"}
        </span>

        {thread.resolved && thread.resolvedBy ? (
          <span className="discussion-thread-resolved-by">
            by {displayName(thread.resolvedBy)}
            {thread.resolvedAt
              ? ` · ${formatTimestamp(thread.resolvedAt)}`
              : ""}
          </span>
        ) : null}

        {isExternal ? (
          <span
            className="discussion-thread-external"
            title="Posted directly in Gitea. Shown for the record; it does not gate publishing."
          >
            From Gitea
          </span>
        ) : null}

        <div className="discussion-thread-header-actions">
          {thread.resolved ? (
            <button
              type="button"
              className="bs-btn bs-btn-secondary discussion-btn-sm"
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? "Show" : "Hide"}
            </button>
          ) : null}

          {canAct ? (
            <button
              type="button"
              className="bs-btn bs-btn-secondary discussion-btn-sm"
              disabled={busy}
              onClick={() => void onToggleResolved(thread.id, !thread.resolved)}
            >
              {thread.resolved ? "Unresolve" : "Resolve thread"}
            </button>
          ) : null}
        </div>
      </header>

      {collapsed ? null : (
        <>
          <ol className="discussion-comments">
            {thread.comments.map((comment) => (
              <li key={comment.id} className="discussion-comment">
                <Avatar author={comment.author} />
                <div className="discussion-comment-main">
                  <div className="discussion-comment-meta">
                    <span className="discussion-comment-author">
                      {displayName(comment.author)}
                    </span>
                    <time
                      className="discussion-comment-time"
                      dateTime={comment.createdAt}
                    >
                      {formatTimestamp(comment.createdAt)}
                    </time>
                  </div>
                  <div className="discussion-comment-body">{comment.body}</div>
                </div>
              </li>
            ))}
          </ol>

          {canAct ? (
            <div className="discussion-reply-form">
              <textarea
                className="vault-pr-comment-input"
                rows={2}
                placeholder="Reply to this thread…"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
              />
              <div className="discussion-reply-actions">
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary"
                  disabled={busy || !replyBody.trim()}
                  onClick={() => void submitReply()}
                >
                  {busy ? "Posting…" : "Reply"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

/** Sort key for the log: everything is ordered by when it happened. */
function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function ReviewDiscussion({
  owner,
  repo,
  pullNumber,
  opening,
  reviews,
  closing,
  canParticipate,
  blockOnUnresolvedThreads,
  onSummaryChange,
}: ReviewDiscussionProps) {
  const [summary, setSummary] = useState<DiscussionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newThreadBody, setNewThreadBody] = useState("");

  // Held in a ref so `apply` stays referentially stable. Callers pass an
  // inline arrow, and letting that identity flow into the load effect's
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
        const next = await listDocumentDiscussions(owner, repo, pullNumber);
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
  }, [owner, repo, pullNumber, apply]);

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

  async function startThread() {
    const body = newThreadBody.trim();
    if (!body) return;
    await run(async () => {
      const next = await createDocumentDiscussion(
        owner,
        repo,
        pullNumber,
        body,
      );
      setNewThreadBody("");
      return next;
    });
  }

  const threads = summary?.threads ?? [];
  const unresolved = summary?.unresolvedCount ?? 0;

  // One column, in the order things happened — the same shape as the history
  // this product exists to produce.
  const entries: { at: number; node: ReactNode }[] = [
    ...threads.map((thread) => ({
      at: timeOf(thread.createdAt),
      node: (
        <Thread
          key={`thread-${thread.id}`}
          thread={thread}
          canParticipate={canParticipate}
          busy={busy}
          onReply={(threadId, body) =>
            run(() =>
              replyToDocumentDiscussion(
                owner,
                repo,
                pullNumber,
                threadId,
                body,
              ),
            )
          }
          onToggleResolved={async (threadId, resolved) => {
            await run(() =>
              resolveDocumentDiscussion(
                owner,
                repo,
                pullNumber,
                threadId,
                resolved,
              ),
            );
          }}
        />
      ),
    })),
    ...reviews.map((review) => ({
      at: timeOf(review.submittedAt),
      node: <ReviewEvent key={`review-${review.id}`} review={review} />,
    })),
  ].sort((left, right) => left.at - right.at);

  return (
    <section className="discussion-panel" aria-label="Review discussion">
      {blockOnUnresolvedThreads && unresolved > 0 ? (
        <p className="discussion-gate-notice" role="status">
          This version cannot be published until every thread is resolved.
        </p>
      ) : null}

      <div className="discussion-timeline">
        <OpeningPost
          author={opening.author}
          at={opening.at}
          body={opening.body}
        />

        {loading ? (
          <p className="vault-pr-notice">Loading the discussion…</p>
        ) : (
          entries.map((entry, index) => (
            <div key={index} className="discussion-timeline-item">
              {entry.node}
            </div>
          ))
        )}

        {closing ? <ClosingEventRow event={closing} /> : null}
      </div>

      {canParticipate ? (
        <div className="discussion-new-thread">
          <textarea
            className="vault-pr-comment-input"
            rows={3}
            placeholder="Raise a concern about this version…"
            value={newThreadBody}
            onChange={(event) => setNewThreadBody(event.target.value)}
          />
          <div className="discussion-reply-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              disabled={busy || !newThreadBody.trim()}
              onClick={() => void startThread()}
            >
              {busy ? "Posting…" : "Start thread"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="vault-pr-error">{error}</p> : null}
    </section>
  );
}
