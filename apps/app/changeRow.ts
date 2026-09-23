/**
 * What a change request's row says, wherever it is listed.
 *
 * **Three lists showed the same change three ways, and all three said too
 * much.** The customer's words: *"It currently displays the title and then a
 * bunch of other junk… I hate the 'X of X approvals · Ready to publish ·
 * Becomes vX'. That is WAYYY too much text. KEEP IT STUPID SIMPLE."*
 *
 * The shape is the one every code host converged on, and it converged for a
 * reason — a list is scanned, not read:
 *
 * ```
 * Monthly audits, fourteen-day training, and point-of-care rub placement.
 * #4 · Alice opened 2 hours ago                    ● Awaiting approval   3
 * ```
 *
 * Four facts: what it asks for, who asked and when, where it stands, how much
 * conversation is on it. Everything else that used to be here belongs on the
 * change's own page, where there is room to say it properly — the approval
 * count, who is holding it up, which version it becomes.
 *
 * **The standing is a word, not a sentence, and never a pill.** A pill is a
 * shape that says "this is unusual"; on every row of every list it says
 * nothing while taking the eye first. A dot carries the colour and the word
 * carries the meaning.
 */

import type { ChangeOutcome } from "./documentDisplay";
import { capitalizeFirst, formatAge } from "./documentDisplay";

/** How a change stands, in one word a reader already knows. */
export type ChangeStandingTone =
  "awaiting" | "changes" | "approved" | "published" | "closed";

export interface ChangeRowFacts {
  /** "#4 · Alice opened 2 hours ago", the line under the title. */
  meta: string;
  tone: ChangeStandingTone;
  /** "Awaiting approval", "Approved", "Changes requested". */
  standing: string;
}

export interface ChangeRowInput {
  number: number;
  submittedBy: string;
  submittedAt: string;
  /** When it last moved. Equal to `submittedAt` when nothing has. */
  updatedAt?: string;
  outcome?: ChangeOutcome | "open" | null;
  approvalCount: number;
  requiredApprovals: number | null;
  isRejected?: boolean;
}

/**
 * "#4 · Alice opened 2 hours ago", or "updated" when it has moved since.
 *
 * A list of changes is read for "what has happened lately", and a row that
 * only ever reports when something opened cannot answer that. The two are told
 * apart by more than a minute, because a change is always saved a moment after
 * it is created and "updated 0 minutes ago" about that is noise.
 */
export function describeChangeMeta(
  change: ChangeRowInput,
  now: number = Date.now(),
): string {
  const who = capitalizeFirst(change.submittedBy || "Someone");
  const opened = Date.parse(change.submittedAt);
  const touched = Date.parse(change.updatedAt ?? change.submittedAt);

  const moved =
    Number.isFinite(opened) &&
    Number.isFinite(touched) &&
    touched - opened > 60_000;

  return moved
    ? `#${change.number} · ${who} · updated ${formatAge(change.updatedAt!, now)}`
    : `#${change.number} · ${who} opened ${formatAge(change.submittedAt, now)}`;
}

/**
 * Where it stands, in one word.
 *
 * **"Waiting on you" is not a standing**, it is a statement about the reader —
 * and it was printed on changes that were approved and ready, which is the
 * thing the customer caught: *"why does a CR say 'Waiting on you' when it's
 * approved to be published?"*. Which list a change is in says who it is
 * waiting on; the row says what state it is in.
 *
 * Worst news first, because a refusal outranks a full count — a change with
 * every approval and a reviewer asking for changes cannot publish, and
 * reporting "Approved" for it would be a lie a reader would act on.
 */
export function describeChangeStandingWord(change: ChangeRowInput): {
  tone: ChangeStandingTone;
  standing: string;
} {
  const outcome = change.outcome ?? "open";

  if (outcome === "published") {
    return { tone: "published", standing: "Published" };
  }
  if (outcome === "declined") return { tone: "closed", standing: "Declined" };
  if (outcome === "withdrawn") return { tone: "closed", standing: "Withdrawn" };

  if (change.isRejected) {
    return { tone: "changes", standing: "Changes requested" };
  }

  const required = change.requiredApprovals;
  const enough =
    required !== null && required > 0 && change.approvalCount >= required;

  return enough
    ? { tone: "approved", standing: "Approved" }
    : { tone: "awaiting", standing: "Awaiting approval" };
}

export function describeChangeRow(
  change: ChangeRowInput,
  now: number = Date.now(),
): ChangeRowFacts {
  return {
    meta: describeChangeMeta(change, now),
    ...describeChangeStandingWord(change),
  };
}
