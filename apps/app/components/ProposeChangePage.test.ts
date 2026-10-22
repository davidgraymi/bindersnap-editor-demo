import { describe, expect, test } from "bun:test";

import { describeActs, distinctActs } from "./ProposeChangePage";

const act = (summary: string, sha: string) =>
  ({ summary, sha, at: "", author: "alice" }) as never;

describe("describeActs", () => {
  test("says each thing once, oldest first, however many times it was saved", () => {
    const acts = [
      act("Edit Code of Conduct", "c"),
      act("Edit Night Shift Escalation", "b"),
      act("Edit Night Shift Escalation", "a"),
    ];
    expect(describeActs(acts)).toBe(
      "- Edit Night Shift Escalation\n- Edit Code of Conduct",
    );
    expect(distinctActs(acts)).toHaveLength(2);
  });
});
