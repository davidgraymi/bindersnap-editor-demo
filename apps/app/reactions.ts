import type { CommentReaction, ReactionKind, ReactionUser } from "./api";
import { capitalizeFirst } from "./documentDisplay";

/**
 * What each reaction means, in words a compliance reviewer would use.
 *
 * The vocabulary is short on purpose — five things a reviewer actually needs
 * to say about a concern. A rocket means nothing on a contract, and every
 * extra option is one more thing somebody has to interpret two years later
 * when they read the record back.
 *
 * `verb` carries both forms because the tooltip is a sentence: "Tom agrees",
 * but "You and Tom agree".
 */
export interface ReactionDisplay {
  kind: ReactionKind;
  emoji: string;
  /** The word on the picker button. */
  label: string;
  verb: { one: string; many: string };
}

export const REACTION_DISPLAY: readonly ReactionDisplay[] = [
  {
    kind: "+1",
    emoji: "👍",
    label: "Agree",
    verb: { one: "agrees", many: "agree" },
  },
  {
    kind: "-1",
    emoji: "👎",
    label: "Disagree",
    verb: { one: "disagrees", many: "disagree" },
  },
  {
    kind: "confused",
    emoji: "🤔",
    label: "Not clear",
    verb: { one: "finds this unclear", many: "find this unclear" },
  },
  {
    kind: "eyes",
    emoji: "👀",
    label: "Looking into it",
    verb: { one: "is looking into this", many: "are looking into this" },
  },
  {
    kind: "heart",
    emoji: "❤️",
    label: "Thanks",
    verb: { one: "says thanks", many: "say thanks" },
  },
];

export function findReactionDisplay(kind: string): ReactionDisplay | undefined {
  return REACTION_DISPLAY.find((entry) => entry.kind === kind);
}

/** How many names a tooltip spells out before it starts counting instead. */
const MAX_NAMES = 3;

function personName(user: ReactionUser): string {
  return user.fullName.trim() || capitalizeFirst(user.login);
}

/**
 * Join names the way a person would: "Tom", "Tom and Maya", "Tom, Maya and
 * Priya". Beyond three, the rest become a count — a tooltip is not a roster.
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;

  const shown = names.slice(0, MAX_NAMES);
  const remaining = names.length - shown.length;

  if (remaining > 0) {
    return `${shown.join(", ")} and ${remaining} ${
      remaining === 1 ? "other" : "others"
    }`;
  }

  const last = shown.pop()!;
  return `${shown.join(", ")} and ${last}`;
}

/**
 * The sentence behind a reaction chip: who left it, and what they meant.
 *
 * The reader comes first and is named "You", because the first thing anybody
 * checks about a count is whether they are already in it.
 */
export function describeReaction(
  reaction: CommentReaction,
  currentUsername: string,
): string {
  const display = findReactionDisplay(reaction.content);
  if (!display) return "";

  const mine = reaction.users.filter(
    (user) => currentUsername && user.login === currentUsername,
  );
  const others = reaction.users.filter(
    (user) => !currentUsername || user.login !== currentUsername,
  );

  const names = [
    ...mine.map(() => "You"),
    ...others.map((user) => personName(user)),
  ];

  if (names.length === 0) return display.label;

  // "You agree", not "You agrees" — the reader is always addressed in the
  // plural form, however many of them there are.
  const plural = names.length > 1 || names[0] === "You";
  return `${joinNames(names)} ${plural ? display.verb.many : display.verb.one}`;
}

/**
 * The picker's label for one option, given what pressing it would do.
 * A reaction already left says how to take it back, because that is the only
 * thing pressing it again can do.
 */
export function describeReactionAction(
  display: ReactionDisplay,
  viewerReacted: boolean,
): string {
  return viewerReacted
    ? `Take back "${display.label}"`
    : `React with "${display.label}"`;
}

/**
 * Move one reaction on one comment without waiting for the server.
 *
 * The chips are the cheapest possible thing on the page and the round trip is
 * not: a reader who presses "Agree" should see it land, and the response that
 * follows overwrites this anyway. Returns a new list — nothing is mutated.
 */
export function applyReactionLocally(
  reactions: CommentReaction[],
  kind: ReactionKind,
  on: boolean,
  viewer: ReactionUser,
): CommentReaction[] {
  const existing = reactions.find((reaction) => reaction.content === kind);

  if (!existing) {
    if (!on) return reactions;
    const added: CommentReaction = {
      content: kind,
      count: 1,
      viewerReacted: true,
      users: [viewer],
    };
    // Keep the vocabulary's order so a new chip appears where it belongs
    // rather than always at the end.
    return [...reactions, added].sort(
      (left, right) =>
        REACTION_DISPLAY.findIndex((entry) => entry.kind === left.content) -
        REACTION_DISPLAY.findIndex((entry) => entry.kind === right.content),
    );
  }

  const users = on
    ? existing.users.some((user) => user.login === viewer.login)
      ? existing.users
      : [...existing.users, viewer]
    : existing.users.filter((user) => user.login !== viewer.login);

  if (users.length === 0) {
    return reactions.filter((reaction) => reaction.content !== kind);
  }

  return reactions.map((reaction) =>
    reaction.content === kind
      ? { ...reaction, count: users.length, viewerReacted: on, users }
      : reaction,
  );
}
