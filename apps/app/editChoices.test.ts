import { describe, expect, test } from "bun:test";

import { describeEditChoices, editChoices, whoseChange } from "./editChoices";

const alice = { login: "alice", full_name: "Alice Nguyen" };
const bob = { login: "bob", full_name: "" };

describe("editChoices", () => {
  test("the author and a co-editor may continue; anybody else may not", () => {
    const changes = [
      { number: 7, title: "Hand hygiene", user: alice, coEditors: [bob] },
    ];
    expect(editChoices(changes, "alice")[0]).toMatchObject({
      canContinue: true,
      mine: true,
      authorName: "You",
    });
    expect(editChoices(changes, "bob")[0]).toMatchObject({
      canContinue: true,
      mine: false,
      authorName: "Alice Nguyen",
    });
    expect(editChoices(changes, "carol")[0]).toMatchObject({
      canContinue: false,
      mine: false,
    });
  });

  test("a change with no co-editors listed is its author's alone", () => {
    const choice = editChoices(
      [{ number: 3, title: "x", user: alice }],
      "bob",
    )[0]!;
    expect(choice.canContinue).toBe(false);
  });

  test("the ones you can continue come first, then by number", () => {
    const choices = editChoices(
      [
        { number: 9, title: "Theirs", user: alice },
        { number: 4, title: "Also theirs", user: alice },
        { number: 12, title: "Yours", user: bob },
      ],
      "bob",
    );
    expect(choices.map((choice) => choice.number)).toEqual([12, 4, 9]);
  });

  test("a person with no name set is called by their login", () => {
    const choice = editChoices([{ number: 1, title: "x", user: bob }], "x")[0]!;
    expect(choice.authorName).toBe("bob");
    expect(whoseChange(choice)).toBe("bob’s change");
  });

  test("an untitled change is called by its number", () => {
    const choice = editChoices(
      [{ number: 5, title: "  ", user: alice }],
      "x",
    )[0]!;
    expect(choice.title).toBe("Change 5");
  });
});

describe("describeEditChoices", () => {
  test("names the one person, or counts several", () => {
    const one = editChoices([{ number: 1, title: "x", user: alice }], "carol");
    expect(describeEditChoices(one)).toBe(
      "Alice Nguyen is already changing this document.",
    );
    const yours = editChoices(
      [{ number: 1, title: "x", user: alice }],
      "alice",
    );
    expect(describeEditChoices(yours)).toBe(
      "You already have a change open for this document.",
    );
    const two = editChoices(
      [
        { number: 1, title: "x", user: alice },
        { number: 2, title: "y", user: bob },
      ],
      "carol",
    );
    expect(describeEditChoices(two)).toBe(
      "2 open changes already change this document.",
    );
  });
});
