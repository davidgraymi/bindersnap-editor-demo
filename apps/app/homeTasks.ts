/**
 * Your turn: what Home lists first.
 *
 * Home and the change requests page answer two different questions, and for
 * a while they did not. Home began as a cut-down copy of the change list,
 * then became a feed of everything that happened, with what was waiting on
 * the reader reduced to a count that led away. The person this is built for
 * runs compliance at a small provider and opens Bindersnap a few times a
 * month, usually because an email said something needs them. What they
 * arrive asking is "what do I have to do?" A feed makes them read to find
 * out; a count makes them click to find out.
 *
 * So Home says it: **only what is waiting on you, each with the one thing to
 * do about it.** Review what you were asked to review. Revise what was sent
 * back to you. Publish what was approved. Carry on with a draft you have not
 * proposed. Nothing else is on the list, so an empty list means you are
 * done, which is the thing a to-do list is for.
 *
 * The change requests page is the other question — "what is going on?" —
 * and stays as it is: every change in flight, yours or not, by the state it
 * is in. The two do not repeat each other. This list is by person and by
 * verb, takes in drafts, and leaves out everything that is somebody else's
 * move; that page is by state and leaves nothing out.
 */

import type { MyDraft } from "../../packages/api-schema/schemas/workspaces";
import { buildBinderUrl } from "./binderShell";
import { formatAge, formatDocumentName } from "./documentDisplay";
import type { QueueRow } from "./reviewQueue";

/** What is being asked of the reader. Listed in this order. */
export type HomeTaskKind = "review" | "revise" | "publish" | "draft";

export interface HomeTask {
  key: string;
  kind: HomeTaskKind;
  /** What the change, or the draft, is called. */
  title: string;
  /** Why it is the reader's turn, then where and when. */
  detail: string;
  /** The one thing to do: "Review", "Revise", "Publish", "Continue". */
  action: string;
  href: string;
}

const ORDER: Record<HomeTaskKind, number> = {
  review: 0,
  revise: 1,
  publish: 2,
  draft: 3,
};

const ACTIONS: Record<HomeTaskKind, string> = {
  review: "Review",
  revise: "Revise",
  publish: "Publish",
  draft: "Continue",
};

/** Why a change is the reader's turn — the words that lead its second line. */
const REASONS: Record<Exclude<HomeTaskKind, "draft">, string> = {
  review: "Your review was asked for",
  revise: "Changes were asked for",
  publish: "Approved",
};

/** Which of the reader's turns a change is, if it is one at all. */
function taskKindOf(row: QueueRow): Exclude<HomeTaskKind, "draft"> | null {
  // Asked and not answered is your turn whoever proposed it.
  if (row.section === "your_review") return "review";
  // After that, only your own changes are yours to move: somebody else's
  // change that was sent back is waiting on them.
  if (!row.mine) return null;
  if (row.section === "changes_requested") return "revise";
  if (row.section === "ready") return "publish";
  return null;
}

/**
 * Everything waiting on the reader, in the order to do it.
 *
 * `rows` are the change requests page's own rows, so the two pages cannot
 * disagree about where a change stands. A draft is listed only while it has
 * something in it and has not been proposed: an empty draft asks nothing,
 * and a proposed one is a change request, listed (or not) as one.
 */
export function buildHomeTasks(
  rows: readonly QueueRow[],
  drafts: readonly MyDraft[],
  now: number = Date.now(),
): HomeTask[] {
  const tasks: Array<HomeTask & { movedAt: number }> = [];

  for (const row of rows) {
    const kind = taskKindOf(row);
    if (!kind) continue;
    tasks.push({
      key: `change:${row.key}`,
      kind,
      title: row.title,
      detail: `${REASONS[kind]} · ${row.binderName}`,
      action: ACTIONS[kind],
      href: buildBinderUrl({
        org: row.owner,
        binder: row.repo,
        tab: "changes",
        change: row.number,
      }),
      movedAt: row.movedAt,
    });
  }

  for (const draft of drafts) {
    if (draft.changeNumber !== null || draft.documentCount === 0) continue;
    const edited = draft.updatedAt ? new Date(draft.updatedAt).getTime() : 0;
    const age = draft.updatedAt ? formatAge(draft.updatedAt, now) : "";
    tasks.push({
      key: `draft:${draft.organization}/${draft.workspace}/${draft.branch}`,
      kind: "draft",
      title: draft.name,
      detail: [
        "Draft, not proposed yet",
        formatDocumentName(draft.workspace),
        age ? `edited ${age}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      action: ACTIONS.draft,
      href: buildBinderUrl({
        org: draft.organization,
        binder: draft.workspace,
        edit: "editing",
        draft: draft.branch,
      }),
      movedAt: Number.isNaN(edited) ? 0 : edited,
    });
  }

  return tasks
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.movedAt - a.movedAt)
    .map(({ movedAt: _movedAt, ...task }) => task);
}

/** The line under the greeting. */
export function describeHomeTasks(count: number): string {
  if (count === 0) return "Nothing is waiting on you.";
  return count === 1
    ? "1 thing is waiting on you."
    : `${count} things are waiting on you.`;
}
