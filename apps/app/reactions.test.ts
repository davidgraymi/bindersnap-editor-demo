import { expect, test } from "bun:test";

import type { CommentReaction } from "./api";
import {
  applyReactionLocally,
  describeReaction,
  describeReactionAction,
  findReactionDisplay,
  REACTION_DISPLAY,
} from "./reactions";

function person(login: string, fullName = "") {
  return { login, fullName };
}

function reaction(
  content: CommentReaction["content"],
  users: { login: string; fullName: string }[],
  viewerReacted = false,
): CommentReaction {
  return { content, count: users.length, viewerReacted, users };
}

test("the reader is named first, and always in the plural", () => {
  const sentence = describeReaction(
    reaction("+1", [person("tom", "Tom Ward"), person("maya", "Maya Khan")]),
    "maya",
  );
  expect(sentence).toBe("You and Tom Ward agree");
});

test("one other person reads in the singular", () => {
  expect(
    describeReaction(reaction("+1", [person("tom", "Tom Ward")]), "maya"),
  ).toBe("Tom Ward agrees");
});

test("the reader alone still reads in the plural", () => {
  expect(describeReaction(reaction("heart", [person("maya")]), "maya")).toBe(
    "You say thanks",
  );
});

test("a login stands in when somebody has no full name", () => {
  expect(describeReaction(reaction("-1", [person("tom")]), "maya")).toBe(
    "Tom disagrees",
  );
});

test("beyond three names the rest become a count", () => {
  const sentence = describeReaction(
    reaction("eyes", [
      person("a", "Ann"),
      person("b", "Ben"),
      person("c", "Cara"),
      person("d", "Dev"),
      person("e", "Eve"),
    ]),
    "",
  );
  expect(sentence).toBe("Ann, Ben, Cara and 2 others are looking into this");
});

test("three names are all spelled out", () => {
  expect(
    describeReaction(
      reaction("confused", [
        person("a", "Ann"),
        person("b", "Ben"),
        person("c", "Cara"),
      ]),
      "",
    ),
  ).toBe("Ann, Ben and Cara find this unclear");
});

test("a signed-out reader is never named as themselves", () => {
  expect(describeReaction(reaction("+1", [person("tom", "Tom")]), "")).toBe(
    "Tom agrees",
  );
});

test("the picker says what pressing it would do", () => {
  const agree = findReactionDisplay("+1")!;
  expect(describeReactionAction(agree, false)).toBe('React with "Agree"');
  expect(describeReactionAction(agree, true)).toBe('Take back "Agree"');
});

test("the vocabulary is five reactions and no emoji tray", () => {
  expect(REACTION_DISPLAY.map((entry) => entry.kind)).toEqual([
    "+1",
    "-1",
    "confused",
    "eyes",
    "heart",
  ]);
  expect(findReactionDisplay("rocket")).toBeUndefined();
});

test("pressing an empty reaction adds the reader to it", () => {
  const next = applyReactionLocally([], "+1", true, person("maya"));
  expect(next).toEqual([reaction("+1", [person("maya")], true)]);
});

test("a new chip lands in vocabulary order, not at the end", () => {
  const next = applyReactionLocally(
    [reaction("heart", [person("tom")])],
    "+1",
    true,
    person("maya"),
  );
  expect(next.map((entry) => entry.content)).toEqual(["+1", "heart"]);
});

test("pressing a reaction the reader already left takes it back", () => {
  const next = applyReactionLocally(
    [reaction("+1", [person("maya"), person("tom")], true)],
    "+1",
    false,
    person("maya"),
  );
  expect(next[0]).toMatchObject({ count: 1, viewerReacted: false });
  expect(next[0]?.users.map((user) => user.login)).toEqual(["tom"]);
});

test("taking back the last reaction removes the chip entirely", () => {
  const next = applyReactionLocally(
    [reaction("+1", [person("maya")], true)],
    "+1",
    false,
    person("maya"),
  );
  expect(next).toEqual([]);
});

test("reacting twice does not count the reader twice", () => {
  const once = applyReactionLocally([], "+1", true, person("maya"));
  const twice = applyReactionLocally(once, "+1", true, person("maya"));
  expect(twice[0]?.count).toBe(1);
});

test("the list handed in is never mutated", () => {
  const before = [reaction("+1", [person("tom")])];
  const snapshot = JSON.parse(JSON.stringify(before));
  applyReactionLocally(before, "+1", true, person("maya"));
  expect(before).toEqual(snapshot);
});
