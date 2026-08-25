import { useEffect, useRef, useState } from "react";
import { Check, SmilePlus } from "lucide-react";

import type {
  CommentReaction,
  DiscussionComment,
  DiscussionThread,
  ReactionKind,
} from "../api";
import { buildThreadFacts, formatEventDate } from "../changeReview";
import { capitalizeFirst } from "../documentDisplay";
import {
  describeReaction,
  describeReactionAction,
  findReactionDisplay,
  REACTION_DISPLAY,
} from "../reactions";
import { PersonAvatar } from "./PersonAvatar";

interface ReviewThreadProps {
  thread: DiscussionThread;
  /** Read-only visitors get the record without the controls. */
  canParticipate: boolean;
  busy: boolean;
  /** Whose reactions read as "You". Empty for a signed-out reader. */
  currentUsername: string;
  onReply: (threadId: string, body: string) => Promise<boolean>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  onReact: (
    threadId: string,
    commentId: number,
    content: ReactionKind,
    on: boolean,
  ) => void;
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
  currentUsername,
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

      {hidden ? null : (
        <>
          <ReactionRow
            comment={root}
            canAct={canAct}
            currentUsername={currentUsername}
            onReact={(content, on) => onReact(thread.id, root.id, content, on)}
          />

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
              <ReactionRow
                comment={comment}
                canAct={canAct}
                currentUsername={currentUsername}
                onReact={(content, on) =>
                  onReact(thread.id, comment.id, content, on)
                }
              />
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

/**
 * The reactions on one comment, and the way to leave one.
 *
 * A chip is a toggle, not a tally: pressing one adds the reader's name to it
 * and pressing it again takes it back. The counts sit under the comment they
 * are about rather than in the thread header, because a thread of five
 * comments has five different things somebody might be agreeing with.
 *
 * Reactions never enter the approval record — they are not a review, and they
 * do not resolve anything. They exist so agreeing with a concern costs the
 * record nothing, instead of a fourth comment reading "+1".
 */
function ReactionRow({
  comment,
  canAct,
  currentUsername,
  onReact,
}: {
  comment: DiscussionComment;
  canAct: boolean;
  currentUsername: string;
  onReact: (content: ReactionKind, on: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen]);

  // Nothing to show and nothing to press: a read-only reader gets the comment
  // without an empty row under it.
  if (comment.reactions.length === 0 && !canAct) return null;

  return (
    <div className="rev-reactions">
      {comment.reactions.map((reaction) => (
        <ReactionChip
          key={reaction.content}
          reaction={reaction}
          canAct={canAct}
          currentUsername={currentUsername}
          onReact={onReact}
        />
      ))}

      {canAct ? (
        <div className="rev-reaction-picker" ref={pickerRef}>
          <button
            type="button"
            className="rev-reaction-add"
            aria-label="React to this comment"
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <SmilePlus size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>

          {pickerOpen ? (
            <div className="rev-reaction-menu" role="menu">
              {REACTION_DISPLAY.map((display) => {
                const existing = comment.reactions.find(
                  (reaction) => reaction.content === display.kind,
                );
                const mine = existing?.viewerReacted ?? false;
                return (
                  <button
                    key={display.kind}
                    type="button"
                    role="menuitem"
                    className={`rev-reaction-menu-item${
                      mine ? " rev-reaction-menu-item--on" : ""
                    }`}
                    // The menu reads as five words, not five sentences; what
                    // pressing one would do is said to a screen reader and on
                    // hover instead.
                    title={describeReactionAction(display, mine)}
                    aria-label={describeReactionAction(display, mine)}
                    onClick={() => {
                      setPickerOpen(false);
                      onReact(display.kind, !mine);
                    }}
                  >
                    <span className="rev-reaction-emoji" aria-hidden="true">
                      {display.emoji}
                    </span>
                    {display.label}
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

function ReactionChip({
  reaction,
  canAct,
  currentUsername,
  onReact,
}: {
  reaction: CommentReaction;
  canAct: boolean;
  currentUsername: string;
  onReact: (content: ReactionKind, on: boolean) => void;
}) {
  const display = findReactionDisplay(reaction.content);
  if (!display) return null;

  const sentence = describeReaction(reaction, currentUsername);

  return (
    <button
      type="button"
      className={`rev-reaction${reaction.viewerReacted ? " rev-reaction--on" : ""}`}
      // A reader who cannot act still gets the count and who left it; the
      // button simply does not move.
      disabled={!canAct}
      aria-pressed={reaction.viewerReacted}
      title={sentence}
      aria-label={sentence}
      onClick={() => onReact(display.kind, !reaction.viewerReacted)}
    >
      <span className="rev-reaction-emoji" aria-hidden="true">
        {display.emoji}
      </span>
      <span className="rev-reaction-count">{reaction.count}</span>
    </button>
  );
}
