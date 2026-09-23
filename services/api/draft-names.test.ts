import { expect, test } from "bun:test";

import {
  defaultDraftName,
  describeUnnamedDraft,
  MAX_DRAFT_NAME_LENGTH,
  normalizeDraftName,
} from "./draft-names";

test("a name is tidied rather than taken as typed", () => {
  expect(normalizeDraftName("  Reorganise   nursing  ")).toBe(
    "Reorganise nursing",
  );
});

/**
 * Refused rather than defaulted.
 *
 * A draft with a name its author wrote is the point of the whole change;
 * quietly calling an empty one "Untitled" would put somebody's mistake back in
 * front of them later as a label they did not write.
 */
test("a name that is only whitespace is refused", () => {
  expect(normalizeDraftName("   ")).toBeNull();
  expect(normalizeDraftName("")).toBeNull();
  expect(normalizeDraftName(undefined)).toBeNull();
  expect(normalizeDraftName(42)).toBeNull();
});

test("a name is bounded, because it is a label and not a description", () => {
  const long = "a".repeat(MAX_DRAFT_NAME_LENGTH + 40);
  expect(normalizeDraftName(long)).toHaveLength(MAX_DRAFT_NAME_LENGTH);
});

/**
 * Pressing Edit does not ask for a name, so the draft takes its date.
 *
 * The common case is one draft, and a name earns itself when there is
 * something to tell apart. Fixed at creation rather than derived at read time,
 * so it cannot drift under the person who recognised it.
 */
test("a draft started without a name is called by its date", () => {
  expect(defaultDraftName(new Date("2026-09-19T10:00:00Z"))).toBe(
    "Draft of 19 September",
  );
});

/** For drafts that already existed when names arrived. */
test("a draft with no row of its own is named by when it was last touched", () => {
  expect(describeUnnamedDraft("2026-09-17T13:25:06Z")).toBe(
    "Draft of 17 September",
  );
  expect(describeUnnamedDraft(null)).toBe("Untitled draft");
  expect(describeUnnamedDraft("not-a-date")).toBe("Untitled draft");
});
