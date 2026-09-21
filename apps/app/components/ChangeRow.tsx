import {
  CircleCheck,
  CircleSlash,
  FilePen,
  MessageSquare,
  Undo2,
} from "lucide-react";

import type { ChangeRowInput } from "../changeRow";
import { describeChangeRow } from "../changeRow";

/**
 * One change request in a list, wherever it is listed.
 *
 * Home, the review queue and a binder's own Changes tab drew this three
 * different ways and all three said too much. One component now, so they
 * cannot drift again and so "what does a change row say" has one answer.
 *
 * See `changeRow.ts` for what it says and why it says so little.
 */

interface ChangeRowProps {
  change: ChangeRowInput & { title: string; commentCount?: number };
  onOpen: () => void;
  /**
   * The act this row offers, when it offers one.
   *
   * Publish, on a change that is ready and yours to publish. Nothing else: a
   * list is for finding the thing you want, and every button on every row is
   * a decision taken without opening what it is about.
   */
  action?: React.ReactNode;
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

export function ChangeRow({ change, onOpen, action = null }: ChangeRowProps) {
  const facts = describeChangeRow(change);
  const comments = change.commentCount ?? 0;

  return (
    <li className="bs-row change-row">
      <span className="bs-row-icon">
        <ChangeIcon outcome={change.outcome} />
      </span>
      <button
        type="button"
        className="bs-row-body change-row-open"
        onClick={onOpen}
      >
        <span className="bs-row-name change-row-title">{change.title}</span>
        <span className="bs-row-meta">{facts.meta}</span>
      </button>

      <span className="bs-row-right change-row-right">
        {/* A dot carries the colour and the word carries the meaning. A pill
            is a shape that says "this is unusual", and on every row of every
            list it says nothing while taking the eye first. */}
        <span className={`change-standing change-standing--${facts.tone}`}>
          <span className="change-standing-dot" aria-hidden="true" />
          {facts.standing}
        </span>

        {/* Only when there is a conversation to join. A zero beside every row
            is a column of zeroes. */}
        {comments > 0 ? (
          <span
            className="change-row-comments"
            title={comments === 1 ? "1 comment" : `${comments} comments`}
          >
            <MessageSquare size={13} strokeWidth={1.75} aria-hidden="true" />
            {comments}
          </span>
        ) : null}

        {action}
      </span>
    </li>
  );
}
