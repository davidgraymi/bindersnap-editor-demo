import type { ThreadReaction } from "./api";

/**
 * How a reaction looks and what it means.
 *
 * The picker offers six, and each one has a job in a review: agree, disagree,
 * "I'm on it", thanks, praise, and "I don't follow". A wall of thirty emoji
 * would be a wall of thirty ways to say nothing — these are the six a reviewer
 * actually needs, and every one of them is a sentence somebody would otherwise
 * have had to type.
 *
 * The names on the left are Gitea's own reaction names, because that is where
 * the reaction is stored. Nothing here is Bindersnap state.
 */

export interface ReactionChoice {
  content: string;
  emoji: string;
  /** What leaving it says, used as the button's label and its tooltip. */
  label: string;
}

export const REACTION_CHOICES: ReactionChoice[] = [
  { content: "+1", emoji: "👍", label: "Agree" },
  { content: "-1", emoji: "👎", label: "Disagree" },
  { content: "eyes", emoji: "👀", label: "Looking into it" },
  { content: "heart", emoji: "❤️", label: "Thanks" },
  { content: "hooray", emoji: "🎉", label: "Nice work" },
  { content: "confused", emoji: "😕", label: "Not following" },
];

/**
 * Reactions Bindersnap does not offer but Gitea may still hold.
 *
 * An instance with a wider `ALLOWED_REACTIONS`, or somebody reacting from the
 * Gitea UI, can put one of these on a comment. Showing it as the emoji it is
 * beats showing the reader the word "rocket".
 */
const OTHER_EMOJI: Record<string, string> = {
  laugh: "😄",
  rocket: "🚀",
};

const CHOICES_BY_CONTENT = new Map(
  REACTION_CHOICES.map((choice) => [choice.content, choice]),
);

export function reactionEmoji(content: string): string {
  return (
    CHOICES_BY_CONTENT.get(content)?.emoji ?? OTHER_EMOJI[content] ?? content
  );
}

export function reactionLabel(content: string): string {
  return CHOICES_BY_CONTENT.get(content)?.label ?? content;
}

/** "Maya", "Maya and Kit", "Maya, Kit and Dana", "Maya, Kit and 3 others". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;

  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;

  if (rest > 0) {
    return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  }

  const last = shown.pop()!;
  return `${shown.join(", ")} and ${last}`;
}

/**
 * The chip's tooltip: who reacted, and what they meant by it.
 *
 * The reader's own name is in the list like anyone else's. The chip is already
 * marked as theirs visually, and quietly rewriting one of the names to "you"
 * would mean the tooltip and the record disagree about who is on the thread.
 */
export function describeReaction(reaction: ThreadReaction): string {
  const who = joinNames(reaction.users);
  const meaning = reactionLabel(reaction.content);
  return who ? `${who} — ${meaning}` : meaning;
}

/** What the button does next: leave this reaction, or take it back. */
export function describeReactionAction(reaction: ThreadReaction): string {
  const meaning = reactionLabel(reaction.content);
  return reaction.reactedByViewer
    ? `Take back “${meaning}”`
    : `React “${meaning}”`;
}
