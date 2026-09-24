import {
  CircleCheck,
  CircleSlash,
  FilePen,
  MessageSquare,
  Undo2,
} from "lucide-react";

import type { ChangeRowInput, ChangeStandingTone } from "../changeRow";
import { describeChangeRow } from "../changeRow";

/**
 * One change request in a list, wherever it is listed.
 *
 * Home, the review queue and a binder's own Changes tab drew this three
 * different ways and all three said too much. One component now, so they
 * cannot drift again and so "what does a change row say" has one answer.
 *
 * Two layers, because the lists know different things: a binder's list has
 * the change itself and lets `ChangeRow` work out what to say, while Home and
 * the queue arrive with the sentence already decided (whose turn it is, which
 * binder) and hand it to `ChangeRowView`. Either way it is drawn once.
 *
 * No buttons on the row. A list is for finding the change; every act on it —
 * approving, publishing — is a decision, and a decision is taken on the
 * change's own page, where what it does is in front of you.
 *
 * See `changeRow.ts` for what it says and why it says so little.
 */

interface ChangeRowProps {
  change: ChangeRowInput & { title: string; commentCount?: number };
  onOpen: () => void;
}

/**
 * The icon carries the outcome, so the list reads before it is read.
 *
 * **Not git glyphs.** A branch-fork and a merge-arrow are precise to anyone
 * who has used GitHub and unreadable to everyone else, and the reader here is
 * a compliance manager. A document-with-a-pen for a change somebody is still
 * proposing, and a tick for one that is published, say the same thing without
 * the vocabulary lesson.
 */
function ChangeIcon({ outcome }: { outcome: ChangeRowInput["outcome"] }) {
  const props = { size: 16, strokeWidth: 1.5, "aria-hidden": true } as const;

  if (outcome === "published") {
    return (
      <CircleCheck
        className="change-row-icon change-row-icon--published"
        {...props}
      />
    );
  }
  if (outcome === "declined") {
    return (
      <CircleSlash
        className="change-row-icon change-row-icon--declined"
        {...props}
      />
    );
  }
  if (outcome === "withdrawn") {
    return (
      <Undo2
        className="change-row-icon change-row-icon--withdrawn"
        {...props}
      />
    );
  }
  return (
    <FilePen className="change-row-icon change-row-icon--open" {...props} />
  );
}

export function ChangeRow({ change, onOpen }: ChangeRowProps) {
  const facts = describeChangeRow(change);
  return (
    <ChangeRowView
      title={change.title}
      meta={facts.meta}
      tone={facts.tone}
      standing={facts.standing}
      outcome={change.outcome}
      commentCount={change.commentCount ?? 0}
      onOpen={onOpen}
    />
  );
}

interface ChangeRowViewProps {
  title: string;
  /** "#4 · Alice opened 2 hours ago". */
  meta: string;
  /**
   * Where the change is, when the list spans more than one place — the binder
   * or the document, set before the meta in the same muted line.
   */
  context?: string | null;
  tone: ChangeStandingTone;
  standing: string;
  outcome?: ChangeRowInput["outcome"];
  commentCount?: number;
  onOpen: () => void;
}

/** The row itself, for a list that has already decided what it says. */
export function ChangeRowView({
  title,
  meta,
  context = null,
  tone,
  standing,
  outcome,
  commentCount = 0,
  onOpen,
}: ChangeRowViewProps) {
  return (
    <li className="bs-row change-row">
      <span className="bs-row-icon">
        <ChangeIcon outcome={outcome} />
      </span>
      <button
        type="button"
        className="bs-row-body change-row-open"
        onClick={onOpen}
      >
        <span className="bs-row-name change-row-title">{title}</span>
        <span className="bs-row-meta">
          {context ? (
            <span className="change-row-context">{context} · </span>
          ) : null}
          {meta}
        </span>
      </button>

      <span className="bs-row-right change-row-right">
        {/* A dot carries the colour and the word carries the meaning. A pill
            is a shape that says "this is unusual", and on every row of every
            list it says nothing while taking the eye first. */}
        <span className={`change-standing change-standing--${tone}`}>
          <span className="change-standing-dot" aria-hidden="true" />
          {standing}
        </span>

        {/* **The slot is always here; what goes in it is not.** A count that
            appeared on some rows and not others pushed the standing left on
            exactly those rows, so a list read straight down zig-zagged — the
            customer: *"keep the rows aligned, so make these columns static so
            that the status doesn't shift left or right."* Empty rather than a
            zero: a zero beside every row is still a column of zeroes. */}
        <span
          className="change-row-comments"
          {...(commentCount > 0
            ? {
                title:
                  commentCount === 1 ? "1 comment" : `${commentCount} comments`,
              }
            : { "aria-hidden": true })}
        >
          {commentCount > 0 ? (
            <>
              <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
              {commentCount}
            </>
          ) : null}
        </span>
      </span>
    </li>
  );
}
