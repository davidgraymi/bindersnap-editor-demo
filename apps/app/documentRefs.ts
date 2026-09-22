/**
 * Which version of a document you are reading, and the others on offer.
 *
 * **This replaces a sentence with the word "branch" in it.** The document page
 * opened from a change carried a warning strip reading *"You are reading the
 * branch draft/alice/20260922131449975"* — the customer: *"`branch` is git
 * verbiage. GitHub handles this by putting a branch selector in the file
 * explorer so that it's clear what branch the user is viewing. We should do
 * the same."*
 *
 * Two things are wrong with a strip like that and only one of them is the
 * vocabulary. It also states a fact and offers no act: a reader who has
 * worked out that they are on a proposal still has no way to get to the
 * record, or to the other proposal, without going back through the change.
 * A control says the same thing and answers the next question.
 *
 * **Nothing here says "branch".** A reader of a policy manual has no reason to
 * know that a change request is a branch — ADR 0004 says a change *is* a
 * branch, and that is a fact about the storage. What they need to know is
 * whether what is on screen is the record or a proposal, and whose.
 */

/** One version of the binder this document can be read at. */
export interface ReadableRef {
  /** The change whose proposal this is. Null on the record. */
  change: number | null;
  /** The branch it reads at. Null on the record, which needs no ref. */
  ref: string | null;
  /** On the control itself, so it has to be short. */
  label: string;
  /** The line under it in the menu — what this version is. */
  detail: string;
  /** Where you are. Exactly one entry has it. */
  current: boolean;
}

/**
 * What the file panel needs to draw its control: the versions, and the file.
 *
 * The address carries the document's identity segment, which is what makes
 * switching version safe across a rename: the server resolves an exact path
 * first and falls back to identity, so a change that renames this policy is
 * still somewhere a reader can get to and get back from.
 */
export interface DocumentRefView {
  refs: readonly ReadableRef[];
  address: string;
}

/** What a change looks like from here. The document detail's own shape. */
export interface RefChange {
  number: number;
  title: string;
  branchName: string;
}

/**
 * The record, then every open change touching this document.
 *
 * **The record is always first and always offered**, including while you are
 * reading it. A picker whose current value disappears from its own list is one
 * a reader cannot use to check what they are looking at — and "what does this
 * policy actually say today" is the question a proposal makes urgent.
 */
export function buildReadableRefs(params: {
  openChanges: readonly RefChange[];
  /** The branch on screen, from the address. */
  ref: string | null;
  /** The change on screen, from the address. */
  change: number | null;
}): ReadableRef[] {
  const { openChanges, ref, change } = params;

  // On the record when the address names neither. A ref that is `main` is the
  // record too: the page reads there either way, and an address that happens
  // to spell it out should not produce a second entry saying so.
  const onRecord = change === null && (ref === null || ref === "main");

  const refs: ReadableRef[] = [
    {
      change: null,
      ref: null,
      label: "On the record",
      detail: "Published, and in force",
      current: onRecord,
    },
  ];

  for (const entry of openChanges) {
    refs.push({
      change: entry.number,
      ref: entry.branchName,
      label: `Change #${entry.number}`,
      detail: entry.title,
      current:
        !onRecord && (change === entry.number || ref === entry.branchName),
    });
  }

  // **A draft nobody has proposed yet is still somewhere you can be.** Edit
  // mode reads the binder on a branch that belongs to no change, so without
  // this the control would say "On the record" over a page that is not the
  // record — which is the one thing it exists to prevent.
  if (!refs.some((entry) => entry.current)) {
    refs.push({
      change,
      ref,
      label: change === null ? "Your draft" : `Change #${change}`,
      detail: change === null ? "Not proposed yet" : "Proposed",
      current: true,
    });
  }

  return refs;
}

/** The one you are on. Never undefined: the record is the fallback. */
export function currentRef(refs: readonly ReadableRef[]): ReadableRef {
  return refs.find((entry) => entry.current) ?? refs[0]!;
}
