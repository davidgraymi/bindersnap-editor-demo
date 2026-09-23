import { expect, test } from "bun:test";

import { describeDraft } from "./BinderDraftPicker";

const draft = (over: Partial<Parameters<typeof describeDraft>[0]> = {}) => ({
  branch: "draft/alice/20260919210616",
  name: "Reorganise nursing",
  updatedAt: "2026-09-19T10:00:00Z",
  actCount: 3,
  lastAct: "Rename Nursing to Nursing and Midwifery",
  ...over,
});

test("a draft reads as what is in it and when it was last touched", () => {
  expect(
    describeDraft(
      draft({ updatedAt: new Date(Date.now() - 240_000).toISOString() }),
    ),
  ).toBe("3 changes · edited 4 minutes ago");
});

test("one change is one change", () => {
  expect(
    describeDraft(
      draft({
        actCount: 1,
        updatedAt: new Date(Date.now() - 240_000).toISOString(),
      }),
    ),
  ).toBe("1 change · edited 4 minutes ago");
});

/**
 * A fresh branch's newest commit is `main`'s, so an empty draft made a moment
 * ago reported "edited 2 days ago" — a date about somebody else's work, on a
 * row about yours.
 */
test("a draft with nothing in it has never been edited", () => {
  expect(describeDraft(draft({ actCount: 0 }))).toBe("Nothing in it yet");
});
