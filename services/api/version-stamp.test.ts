import { describe, expect, test } from "bun:test";

import { buildVersionStamp, type PublishedPolicy } from "./version-stamp";

function policy(overrides: Partial<PublishedPolicy> = {}): PublishedPolicy {
  return {
    slugPath: "nursing/infection-control",
    version: 4,
    requiredApprovals: 2,
    approvedBy: ["carol", "dan"],
    blockOnUnresolvedThreads: true,
    signOffEnforced: true,
    publishedBy: "alice",
    changeNumber: 12,
    ...overrides,
  };
}

describe("the summary line", () => {
  test("names the document and the version, and nothing else", () => {
    // It is what git shows wherever a tag is listed, so it carries the two
    // facts that identify the version and no policy detail.
    const [summary] = buildVersionStamp(policy()).split("\n");
    expect(summary).toBe("Published nursing/infection-control v4");
  });
});

describe("the policy in force", () => {
  test("states every rule that shaped the approval", () => {
    const stamp = buildVersionStamp(policy());

    expect(stamp).toContain("Approvals required: 2");
    expect(stamp).toContain("Approved by: carol, dan");
    expect(stamp).toContain("Unresolved discussions blocked publishing: yes");
    expect(stamp).toContain("Per-folder sign-off enforced: yes");
    expect(stamp).toContain("Published by: alice");
    expect(stamp).toContain("From change: #12");
  });

  test("says a rule was off rather than leaving it out", () => {
    // **Both sides of every rule.** A rule that is off is still a rule the
    // customer chose, and a stamp that only listed the rules that were on
    // would be silent about the ones that were not — which is the same
    // ambiguity as no stamp at all.
    const stamp = buildVersionStamp(
      policy({ blockOnUnresolvedThreads: false, signOffEnforced: false }),
    );

    expect(stamp).toContain("Unresolved discussions blocked publishing: no");
    expect(stamp).toContain("Per-folder sign-off enforced: no");
  });

  test("a version nobody approved says so, rather than an empty line", () => {
    // It can happen: a binder can require zero approvals. A blank would read
    // as a rendering fault in a record whose whole job is to be unambiguous.
    const stamp = buildVersionStamp(
      policy({ approvedBy: [], requiredApprovals: 0 }),
    );

    expect(stamp).toContain("Approvals required: 0");
    expect(stamp).toContain("Approved by: nobody");
  });

  test("an unreadable approval count says unknown rather than guessing zero", () => {
    // Branch protection is admin-only, so the service account can fail to read
    // it. "0" would be a claim that no approvals were required, which is a
    // very different statement from "we could not tell".
    expect(buildVersionStamp(policy({ requiredApprovals: null }))).toContain(
      "Approvals required: unknown",
    );
  });

  test("who published is separate from who approved", () => {
    // They are different acts and a record that conflated them would let the
    // publisher look like an approver.
    const stamp = buildVersionStamp(
      policy({ publishedBy: "alice", approvedBy: ["carol"] }),
    );

    expect(stamp).toContain("Approved by: carol");
    expect(stamp).toContain("Published by: alice");
  });
});

test("the stamp is plain text a person can read, not JSON", () => {
  // Nothing in the product parses this back. The audience is somebody running
  // `git tag -n99` on a clone in five years, and a format nothing parses
  // cannot drift out of step with a parser.
  const stamp = buildVersionStamp(policy());
  expect(stamp.trimStart().startsWith("{")).toBe(false);
  expect(stamp.endsWith("\n")).toBe(true);
});
