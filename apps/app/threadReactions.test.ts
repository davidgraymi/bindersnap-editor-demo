import { expect, test } from "bun:test";

import type { ThreadReaction } from "./api";
import {
  REACTION_CHOICES,
  describeReaction,
  describeReactionAction,
  reactionEmoji,
  reactionLabel,
} from "./threadReactions";

function reaction(overrides: Partial<ThreadReaction> = {}): ThreadReaction {
  return {
    content: "+1",
    count: 1,
    users: ["maya"],
    reactedByViewer: false,
    ...overrides,
  };
}

test("every offered reaction has an emoji and says what it means", () => {
  expect(REACTION_CHOICES).toHaveLength(6);
  for (const choice of REACTION_CHOICES) {
    expect(choice.emoji).not.toBe("");
    expect(choice.label).not.toBe(choice.content);
  }
});

test("a reaction Gitea holds but Bindersnap does not offer still reads as an emoji", () => {
  expect(reactionEmoji("rocket")).toBe("🚀");
  expect(reactionEmoji("+1")).toBe("👍");
});

test("an emoji nobody has a name for is shown as whatever Gitea called it", () => {
  expect(reactionEmoji("zap")).toBe("zap");
  expect(reactionLabel("zap")).toBe("zap");
});

test("the tooltip names who reacted and what they meant", () => {
  expect(describeReaction(reaction({ users: ["maya"] }))).toBe("maya — Agree");
  expect(describeReaction(reaction({ users: ["maya", "kit"] }))).toBe(
    "maya and kit — Agree",
  );
  expect(describeReaction(reaction({ users: ["maya", "kit", "dana"] }))).toBe(
    "maya, kit and dana — Agree",
  );
});

test("a crowd is summarised rather than listed to the end", () => {
  expect(
    describeReaction(
      reaction({ users: ["maya", "kit", "dana", "ada", "raj"] }),
    ),
  ).toBe("maya, kit, dana and 2 others — Agree");
});

test("the button says what the click will do", () => {
  expect(describeReactionAction(reaction())).toBe("React “Agree”");
  expect(describeReactionAction(reaction({ reactedByViewer: true }))).toBe(
    "Take back “Agree”",
  );
});
