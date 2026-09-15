import { expect, test } from "bun:test";

import { describeActs } from "./components/ProposeChangePage";
import type { DraftAct } from "../../packages/api-schema/schemas/workspaces";

function act(summary: string, sha: string): DraftAct {
  return { summary, sha, at: null, paths: [] };
}

// ── what the change request starts out saying ──────────────────────

test("the description is the acts, oldest first", () => {
  // The draft answers newest first, because the bar's question is "did that
  // last thing land". A change request is a narrative, and a narrative runs
  // forwards — a reviewer reading "renamed it" before "made the folder" has
  // to reconstruct the order themselves.
  expect(
    describeActs([
      act("Rename Hand Hygiene to Hand Hygiene and PPE", "c"),
      act("File Hand Hygiene under nursing", "b"),
      act("Make the folder nursing", "a"),
    ]),
  ).toBe(
    [
      "- Make the folder nursing",
      "- File Hand Hygiene under nursing",
      "- Rename Hand Hygiene to Hand Hygiene and PPE",
    ].join("\n"),
  );
});

test("one act is still a list, so adding a second needs no reformatting", () => {
  expect(describeActs([act("Make the folder nursing", "a")])).toBe(
    "- Make the folder nursing",
  );
});

test("an empty draft describes nothing rather than an empty bullet", () => {
  // Propose is off at zero acts, so this is defensive — but a lone "- " in the
  // box would be the first thing an author had to delete.
  expect(describeActs([])).toBe("");
});

test("describing does not disturb the order it was given", () => {
  const acts = [act("second", "b"), act("first", "a")];
  describeActs(acts);
  expect(acts.map((entry) => entry.sha)).toEqual(["b", "a"]);
});
