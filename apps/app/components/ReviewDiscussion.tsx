import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDocumentDiscussion,
  listDocumentDiscussions,
  replyToDocumentDiscussion,
  resolveDocumentDiscussion,
  type DiscussionSummary,
  type DiscussionThread,
} from "../api";

interface ReviewDiscussionProps {
  owner: string;
  repo: string;
  pullNumber: number;
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
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

/**
 * One review thread, rendered the way GitHub and GitLab render theirs: the
 * root comment, its replies in order, a resolution banner, and a reply box
 * that only appears once you focus it.
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
  const [replyOpen, setReplyOpen] = useState(false);
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
    // Keep the draft and the open reply box when the post fails, so an error
    // never costs the user the text they wrote.
    const posted = await onReply(thread.id, body);
    if (!posted) return;
    setReplyBody("");
    setReplyOpen(false);
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
            replyOpen ? (
              <div className="discussion-reply-form">
                <textarea
                  className="vault-pr-comment-input"
                  rows={3}
                  autoFocus
                  placeholder="Reply to this thread…"
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                />
                <div className="discussion-reply-actions">
                  <button
                    type="button"
                    className="bs-btn bs-btn-primary"
                    disabled={busy || !replyBody.trim()}
                    onClick={() => void submitReply()}
                  >
                    {busy ? "Posting…" : "Reply"}
                  </button>
                  <button
                    type="button"
                    className="bs-btn bs-btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setReplyOpen(false);
                      setReplyBody("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="discussion-reply-trigger"
                onClick={() => setReplyOpen(true)}
              >
                Reply…
              </button>
            )
          ) : null}
        </>
      )}
    </article>
  );
}

export function ReviewDiscussion({
  owner,
  repo,
  pullNumber,
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

  return (
    <section className="discussion-panel" aria-label="Review discussion">
      <header className="discussion-panel-header">
        <h4 className="discussion-panel-title">Discussion</h4>
        {summary ? (
          <span className="discussion-panel-count">
            {unresolved === 0
              ? `${summary.totalCount} thread${summary.totalCount === 1 ? "" : "s"}, all resolved`
              : `${unresolved} unresolved of ${summary.totalCount}`}
          </span>
        ) : null}
      </header>

      {blockOnUnresolvedThreads && unresolved > 0 ? (
        <p className="discussion-gate-notice" role="status">
          This version cannot be published until every thread is resolved.
        </p>
      ) : null}

      {loading ? (
        <p className="vault-pr-notice">Loading discussion…</p>
      ) : (
        <>
          {threads.length === 0 ? (
            <p className="vault-pr-notice">
              No discussion yet. Start a thread to raise a concern about this
              version.
            </p>
          ) : (
            <div className="discussion-threads">
              {threads.map((thread) => (
                <Thread
                  key={thread.id}
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
              ))}
            </div>
          )}

          {canParticipate ? (
            <div className="discussion-new-thread">
              <textarea
                className="vault-pr-comment-input"
                rows={3}
                placeholder="Start a new thread…"
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
        </>
      )}

      {error ? <p className="vault-pr-error">{error}</p> : null}
    </section>
  );
}
