import { expect, test } from "bun:test";

import { describeOwners, describeTarget } from "./BinderSettings";

test("a rule names who signs it off, on its own row", () => {
  expect(
    describeOwners({ teams: ["infection-control"], users: [] }, []),
  ).toEqual({ text: "Infection Control", holdingNothing: false });
});

test("a rule whose only group is empty says it is holding nothing", () => {
  // Verified against Gitea: an empty team waits for nobody and lets the
  // publish through, so this is the row saying the rule does nothing.
  expect(
    describeOwners({ teams: ["compliance"], users: [] }, ["compliance"]),
  ).toEqual({
    text: "The Compliance group, which has nobody in it",
    holdingNothing: true,
  });
});

test("one empty group beside a real owner still holds the change", () => {
  const owners = describeOwners(
    { teams: ["compliance", "infection-control"], users: [] },
    ["compliance"],
  );
  expect(owners.holdingNothing).toBe(false);
  expect(owners.text).toBe(
    "The Compliance group, which has nobody in it and Infection Control",
  );
});

test("what a rule covers is said as a customer reads it", () => {
  const documents = [
    {
      uid: "01J8",
      slugPath: "nursing/hand-hygiene",
      name: "hand-hygiene",
      folder: "nursing",
    },
  ];
  expect(describeTarget({ scope: "binder", target: "" }, documents)).toBe(
    "Everything in this binder",
  );
  expect(
    describeTarget({ scope: "folder", target: "clinical/nursing" }, documents),
  ).toBe("Anything filed in Clinical / Nursing");
  expect(describeTarget({ scope: "document", target: "01J8" }, documents)).toBe(
    "Hand Hygiene",
  );
  expect(describeTarget({ scope: "document", target: "gone" }, documents)).toBe(
    "A document that is no longer in this binder",
  );
});
