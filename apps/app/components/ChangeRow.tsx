import { AppIcon, ICON } from "./AppIcon";

import { followInApp } from "../appLink";
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
  /** The change's own address, so the row is a link that opens in a tab. */
  href: string;
  onOpen: () => void;
  /** What leads the line under the title — the binder, in a list spanning several. */
  context?: string | null;
}

/**
 * The icon carries the outcome, so the list reads before it is read.
 *
 * **Not git glyphs.** A branch-fork and a merge-arrow are precise to anyone
 * who has used GitHub and unreadable to everyone else, and the reader here is
 * a compliance manager. An open circle for a change still in review, the seal
 * for one that put a version on the record, and a struck circle for one closed
 * without it say the same thing without the vocabulary lesson.
 */
function ChangeIcon({ outcome }: { outcome: ChangeRowInput["outcome"] }) {
  if (outcome === "published") {
    return (
      <AppIcon
        icon={ICON.published}
        size="md"
        className="change-row-icon change-row-icon--published"
      />
    );
  }
  // One mark for every change closed without publishing, as the word is one.
  if (outcome === "declined" || outcome === "withdrawn") {
    return (
      <AppIcon
        icon={ICON.closed}
        size="md"
        className="change-row-icon change-row-icon--closed"
      />
    );
  }
  return (
    <AppIcon
      icon={ICON.open}
      size="md"
      className="change-row-icon change-row-icon--open"
    />
  );
}

export function ChangeRow({
  change,
  href,
  onOpen,
  context = null,
}: ChangeRowProps) {
  const facts = describeChangeRow(change);
  return (
    <ChangeRowView
      title={change.title}
      context={context}
      meta={facts.meta}
      tone={facts.tone}
      standing={facts.standing}
      outcome={change.outcome}
      commentCount={change.commentCount ?? 0}
      href={href}
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
  /**
   * Where the row goes.
   *
   * **A row is a link, the way every list on GitHub and GitLab is.** It was a
   * button that moved the address bar in script, so a reviewer working down a
   * queue could not open three changes in three tabs, see where a row went
   * before clicking it, or copy one to paste into an email.
   */
  href: string;
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
  href,
  onOpen,
}: ChangeRowViewProps) {
  return (
    <li className="bs-row change-row">
      <span className="bs-row-icon">
        <ChangeIcon outcome={outcome} />
      </span>
      <a
        className="bs-row-body change-row-open"
        href={href}
        onClick={(event) => followInApp(event, onOpen)}
      >
        <span className="bs-row-name change-row-title">{title}</span>
        <span className="bs-row-meta">
          {context ? (
            <span className="change-row-context">{context} · </span>
          ) : null}
          {meta}
        </span>
      </a>

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
              <AppIcon icon={ICON.comment} size="sm" />
              {commentCount}
            </>
          ) : null}
        </span>
      </span>
    </li>
  );
}
