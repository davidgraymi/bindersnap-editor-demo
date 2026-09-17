import { describe, expect, test } from "bun:test";

import {
  buildArchiveStamp,
  buildVersionStamp,
  readStampedChange,
  readVersionStamp,
  type ArchivedDocument,
  type PublishedPolicy,
} from "./version-stamp";

function policy(overrides: Partial<PublishedPolicy> = {}): PublishedPolicy {
  return {
    title: "Infection Control",
    slugPath: "nursing/infection-control",
    path: "nursing/infection-control.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
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
  test("names the document, the version and the file, and nothing else", () => {
    // It is what git shows wherever a tag is listed, and the tag name is now a
    // ULID — so this line is the only place a person scanning `git tag -n1`
    // learns which policy they are looking at.
    const [summary] = buildVersionStamp(policy()).split("\n");
    expect(summary).toBe(
      "Infection Control v4 — nursing/infection-control.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
    );
  });

  test("carries no policy detail", () => {
    const [summary] = buildVersionStamp(policy()).split("\n");
    expect(summary).not.toContain("Approvals");
    expect(summary).not.toContain("alice");
  });
});

describe("what the tag name stopped saying", () => {
  test("the title and the path are recorded as they stood at this publish", () => {
    // Both are point-in-time facts. Rename the policy tomorrow and nothing
    // else records what it was called when this version was signed off — the
    // tag name is a ULID and the tree only holds what is true now.
    const stamp = buildVersionStamp(policy());

    expect(stamp).toContain("Title at this version: Infection Control");
    expect(stamp).toContain("Filed at: nursing/infection-control");
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
  // The audience is somebody running `git tag -n99` on a clone in five years.
  // Two labelled lines are read back — see below — and the rest stays prose
  // nothing parses.
  const stamp = buildVersionStamp(policy());
  expect(stamp.trimStart().startsWith("{")).toBe(false);
  expect(stamp.endsWith("\n")).toBe(true);
});

describe("reading a stamp back", () => {
  // **The archive has nowhere else to look.** An archived document is not on
  // `main`, so the tree cannot say what it was called; its tags are the whole
  // of what is left. The writer and the reader are in one file, ten lines
  // apart, and these tests are what keeps them from drifting.

  function archived(
    overrides: Partial<ArchivedDocument> = {},
  ): ArchivedDocument {
    return {
      title: "Infection Control",
      slugPath: "nursing/infection-control",
      path: "nursing/infection-control.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
      lastVersion: 4,
      sequence: 1,
      archivedBy: "alice",
      changeNumber: 12,
      ...overrides,
    };
  }

  test("a version stamp round-trips its title and its path", () => {
    expect(readVersionStamp(buildVersionStamp(policy()))).toEqual({
      title: "Infection Control",
      slugPath: "nursing/infection-control",
    });
  });

  test("a version stamp says which change it came from", () => {
    expect(readStampedChange(buildVersionStamp(policy()))).toBe(
      policy().changeNumber,
    );
    // A tag somebody wrote by hand has no such line, and says so with null.
    expect(readStampedChange("Published nursing/handover v1")).toBeNull();
  });

  test("an archive stamp round-trips the same two facts", () => {
    // One reader, either kind of tag. The archive reads whichever it finds.
    expect(readVersionStamp(buildArchiveStamp(archived()))).toEqual({
      title: "Infection Control",
      slugPath: "nursing/infection-control",
    });
  });

  test("a title with a colon in it survives, because only the label is cut", () => {
    const stamp = buildVersionStamp(
      policy({ title: "Infection Control: Ward Procedures" }),
    );
    expect(readVersionStamp(stamp).title).toBe(
      "Infection Control: Ward Procedures",
    );
  });

  test("a policy at the binder's top level has an address with no folder", () => {
    const stamp = buildVersionStamp(
      policy({ slugPath: "staff-handbook", title: "Staff Handbook" }),
    );
    expect(readVersionStamp(stamp).slugPath).toBe("staff-handbook");
  });

  test("a message with no stamp in it answers null, not a guess", () => {
    // Tags written under ADR 0004, and tags somebody wrote by hand. Costing a
    // heading is right; inventing one is not.
    expect(readVersionStamp("Published nursing/handover v2")).toEqual({
      title: null,
      slugPath: null,
    });
    expect(readVersionStamp("")).toEqual({ title: null, slugPath: null });
  });

  test("a label with nothing after it is nothing, not an empty heading", () => {
    expect(readVersionStamp("  Title at this version:   \n").title).toBeNull();
  });
});

describe("the archive stamp", () => {
  function archived(
    overrides: Partial<ArchivedDocument> = {},
  ): ArchivedDocument {
    return {
      title: "Infection Control",
      slugPath: "nursing/infection-control",
      path: "nursing/infection-control.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
      lastVersion: 4,
      sequence: 1,
      archivedBy: "alice",
      changeNumber: 12,
      ...overrides,
    };
  }

  test("the summary says what happened to what", () => {
    const [summary] = buildArchiveStamp(archived()).split("\n");
    expect(summary).toBe(
      "Infection Control archived — nursing/infection-control.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
    );
  });

  test("it says the versions are unaffected, because that is the worry", () => {
    // Somebody reading this tag in five years is asking whether archiving
    // destroyed the record. It did not, and saying so is free.
    expect(buildArchiveStamp(archived())).toContain(
      "Its published versions are",
    );
    expect(buildArchiveStamp(archived())).toContain("Last version: v4");
  });

  test("who archived it and under which change", () => {
    const stamp = buildArchiveStamp(archived());
    expect(stamp).toContain("Archived by: alice");
    expect(stamp).toContain("From change: #12");
  });

  test("a first archiving says nothing about being a repeat", () => {
    expect(buildArchiveStamp(archived())).not.toContain("archiving number");
  });

  test("a second one says so, because it is a different fact", () => {
    // Archived, restored, archived again. Three dates, three acts, and a
    // reader who is not told would read the second tag as the first.
    expect(buildArchiveStamp(archived({ sequence: 2 }))).toContain(
      "This is archiving number 2 — it was restored and archived again.",
    );
  });

  test("a document that published nothing says so rather than v0", () => {
    expect(buildArchiveStamp(archived({ lastVersion: null }))).toContain(
      "Last version: none",
    );
  });
});
