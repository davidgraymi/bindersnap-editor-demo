import { useEffect, useState } from "react";
import { Check, SmilePlus } from "lucide-react";

import type { DiscussionThread, ThreadReaction } from "../api";
import { buildThreadFacts, formatEventDate } from "../changeReview";
import { capitalizeFirst } from "../documentDisplay";
import {
  REACTION_CHOICES,
  describeReaction,
  describeReactionAction,
  reactionEmoji,
} from "../threadReactions";
import { PersonAvatar } from "./PersonAvatar";

interface ReviewThreadProps {
  thread: DiscussionThread;
  /** Read-only visitors get the record without the controls. */
  canParticipate: boolean;
  busy: boolean;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  onReact: (
    threadId: string,
    content: string,
    reacted: boolean,
  ) => Promise<void>;
}

function displayName(author: { login: string; fullName: string }): string {
  return author.fullName.trim() || capitalizeFirst(author.login);
}

/**
 * The reactions on a thread, and the way to leave one.
 *
 * Reactions hang on the comment that opened the thread, not on every reply: a
 * thread is one conversation about one point, and "I agree" belongs to the
 * point. A chip is a button — clicking one you already left takes it back —
 * and the chips are in a fixed order so they do not swap places under the
 * cursor as votes come in.
 *
 * Nothing here gates publishing. A raised concern blocks a version because
 * somebody wrote a sentence; a thumbs-down is a feeling, and a feeling should
 * never be why a document cannot ship.
 */
function ReactionBar({
  reactions,
  canReact,
  busy,
  onReact,
}: {
  reactions: ThreadReaction[];
  canReact: boolean;
  busy: boolean;
  onReact: (content: string, reacted: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);

  // Escape closes the picker wherever the focus went. Without this the only
  // way out of an accidental click is to pick something.
  useEffect(() => {
    if (!picking) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [picking]);

  const already = new Set(
    reactions
      .filter((reaction) => reaction.reactedByViewer)
      .map((reaction) => reaction.content),
  );

  return (
    <div className="rev-reactions">
      {reactions.map((reaction) => (
        <button
          className={`rev-reaction${
            reaction.reactedByViewer ? " rev-reaction--mine" : ""
          }`}
          key={reaction.content}
          type="button"
          disabled={!canReact || busy}
          aria-pressed={reaction.reactedByViewer}
          title={describeReaction(reaction)}
          aria-label={`${describeReaction(reaction)}. ${describeReactionAction(
            reaction,
          )}`}
          onClick={() => onReact(reaction.content, !reaction.reactedByViewer)}
        >
          <span className="rev-reaction-emoji" aria-hidden="true">
            {reactionEmoji(reaction.content)}
          </span>
          <span className="rev-reaction-count">{reaction.count}</span>
        </button>
      ))}

      {canReact ? (
        <div
          className="rev-reaction-picker"
          onBlur={(event) => {
            // Closing on focus leaving the whole picker keeps a keyboard user
            // inside it while they tab across the six choices.
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setPicking(false);
            }
          }}
        >
          <button
            className="rev-reaction rev-reaction--add"
            type="button"
            disabled={busy}
            aria-expanded={picking}
            aria-haspopup="true"
            title="Add a reaction"
            aria-label="Add a reaction"
            onClick={() => setPicking((value) => !value)}
          >
            <SmilePlus size={13} strokeWidth={1.6} aria-hidden="true" />
          </button>

          {picking ? (
            <div className="rev-reaction-menu" role="menu">
              {REACTION_CHOICES.map((choice) => {
                const mine = already.has(choice.content);
                return (
                  <button
                    className={`rev-reaction-choice${
                      mine ? " rev-reaction-choice--mine" : ""
                    }`}
                    key={choice.content}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    title={choice.label}
                    onClick={() => {
                      setPicking(false);
                      onReact(choice.content, !mine);
                    }}
                  >
                    <span aria-hidden="true">{choice.emoji}</span>
                    <span className="rev-reaction-choice-label">
                      {choice.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
  onReact,
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

      {/* Reactions belong to the root comment, which is on screen even when
          the thread is collapsed — so a collapsed thread still shows what
          people made of it. The picker is not offered there: a collapsed
          thread is meant to be small. */}
      {thread.reactions.length > 0 || (canParticipate && !hidden) ? (
        <ReactionBar
          reactions={thread.reactions}
          canReact={canParticipate && !hidden}
          busy={busy}
          onReact={(content, reacted) =>
            void onReact(thread.id, content, reacted)
          }
        />
      ) : null}

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
