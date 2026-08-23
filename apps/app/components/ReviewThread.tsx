import { useState } from "react";
import { Check } from "lucide-react";

import type { DiscussionThread } from "../api";
import { buildThreadFacts, formatEventDate } from "../changeReview";
import { capitalizeFirst } from "../documentDisplay";
import { PersonAvatar } from "./PersonAvatar";

interface ReviewThreadProps {
  thread: DiscussionThread;
  /** Read-only visitors get the record without the controls. */
  canParticipate: boolean;
  busy: boolean;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
}

function displayName(author: { login: string; fullName: string }): string {
  return author.fullName.trim() || capitalizeFirst(author.login);
}

/**
 * One comment. A reply is what makes it a thread.
 *
 * There is deliberately no separate "comment" and "thread" component: the card
 * is the same either way, and a product that renders the second reply somewhere
 * new is a product where a reader has to relearn the page halfway down it.
 * Replies are full width and separated by a hairline rather than indented —
 * nesting buys nothing when a thread is a conversation between three people
 * about one paragraph.
 *
 * The show/collapse toggle sits in the header, top right, so it holds still.
 * Under the text it moved every time the thread grew, which meant the control
 * for hiding a long thread walked further away the longer the thread got.
 */
export function ReviewThread({
  thread,
  canParticipate,
  busy,
  onReply,
  onToggleResolved,
}: ReviewThreadProps) {
  // Resolved threads open collapsed. A reader who expands one has said they
  // want to read it, and nothing here overrules them afterwards.
  const [collapsed, setCollapsed] = useState(thread.resolved);
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  const facts = buildThreadFacts(thread, collapsed);
  const isExternal = thread.origin === "external";
  const canAct = canParticipate && !isExternal;
  const [root, ...replies] = thread.comments;
  if (!root) return null;

  const hidden = collapsed && facts.collapsible;

  async function submitReply() {
    const body = replyBody.trim();
    if (!body) return;
    // Keep the draft when the post fails — an error should never cost someone
    // the sentence they just wrote.
    const posted = await onReply(thread.id, body);
    if (!posted) return;
    setReplyBody("");
    setReplying(false);
  }

  return (
    <article
      className={`rev-thread${hidden ? " rev-thread--collapsed" : ""}`}
      data-testid="discussion-thread"
    >
      <header className="rev-thread-head">
        <PersonAvatar person={root.author} />
        <strong className="rev-thread-author">
          {displayName(root.author)}
        </strong>
        <time className="rev-thread-date" dateTime={root.createdAt}>
          {formatEventDate(root.createdAt)}
        </time>
        <span className="rev-thread-spacer" />

        {isExternal ? (
          <span
            className="rev-thread-external"
            title="Posted directly in Gitea. Shown for the record; it does not gate publishing."
          >
            From Gitea
          </span>
        ) : facts.resolved ? (
          <span className="rev-mark rev-mark--resolved">
            <Check size={11} strokeWidth={2.2} aria-hidden="true" />
            Resolved
          </span>
        ) : (
          <span className="rev-mark rev-mark--open">
            <span className="rev-mark-dot" aria-hidden="true" />
            Unresolved
          </span>
        )}

        {facts.collapsible ? (
          <button
            className={`rev-thread-toggle${
              // An unresolved thread may still need somebody to act, so its
              // toggle is a shade darker than a resolved one's.
              collapsed && !facts.resolved ? " rev-thread-toggle--live" : ""
            }`}
            type="button"
            onClick={() => setCollapsed((value) => !value)}
          >
            {facts.toggleLabel}
          </button>
        ) : null}
      </header>

      <p className="rev-thread-body">{root.body}</p>

      {hidden ? null : (
        <>
          {replies.map((comment) => (
            <div className="rev-thread-reply" key={comment.id}>
              <div className="rev-thread-head">
                <PersonAvatar person={comment.author} />
                <strong className="rev-thread-author">
                  {displayName(comment.author)}
                </strong>
                <time className="rev-thread-date" dateTime={comment.createdAt}>
                  {formatEventDate(comment.createdAt)}
                </time>
              </div>
              <p className="rev-thread-body">{comment.body}</p>
            </div>
          ))}

          {/* The resolution is part of this thread's own history, not a banner
              floating above it — and it says out loud that it can be undone. */}
          {facts.resolutionNote ? (
            <p className="rev-thread-event">
              <Check size={11} strokeWidth={2.2} aria-hidden="true" />
              {facts.resolutionNote}
            </p>
          ) : null}

          {replying && canAct ? (
            <div className="rev-composer rev-composer--reply">
              <textarea
                className="rev-composer-input"
                rows={2}
                autoFocus
                placeholder="Reply to this thread…"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
              />
              <div className="rev-composer-actions">
                <button
                  className="rev-btn rev-btn--ghost"
                  type="button"
                  disabled={busy || !replyBody.trim()}
                  onClick={() => void submitReply()}
                >
                  {busy ? "Posting…" : "Post reply"}
                </button>
                <button
                  className="rev-link"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setReplying(false);
                    setReplyBody("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {canAct && !replying ? (
            <div className="rev-thread-actions">
              <button
                className="rev-link"
                type="button"
                disabled={busy}
                onClick={() =>
                  void onToggleResolved(thread.id, !thread.resolved)
                }
              >
                {facts.resolved ? "Reopen" : "Resolve"}
              </button>
              <button
                className="rev-link"
                type="button"
                disabled={busy}
                onClick={() => setReplying(true)}
              >
                Reply
              </button>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
