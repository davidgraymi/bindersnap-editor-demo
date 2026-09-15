import { describe, expect, test } from "bun:test";

import {
  folderKeepPath,
  planDocumentArchive,
  planDocumentRename,
  planDocumentRestore,
  planFolderRename,
  planNewFolder,
} from "./binderShape";
import type {
  WorkspaceDocumentEntry,
  WorkspaceTree,
} from "./gitea-client/workspaceDocuments";

/**
 * Working out what a shape change does, before anything is written.
 *
 * All of this is pure: the operations, the refusals and the wording. What
 * Gitea does with the operations is exercised against a real one in
 * `tests/workspace-provisioning.pw.ts`; what they *are* is decided here, where
 * a collision or a folder moved inside itself can be pinned in a line.
 */

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const OTHER = "01J9A0B1C2D3E4F5G6H7J8K9M0";

function document(
  overrides: Partial<WorkspaceDocumentEntry> = {},
): WorkspaceDocumentEntry {
  return {
    path: `nursing/hand-hygiene.${UID}.md`,
    slugPath: "nursing/hand-hygiene",
    name: "hand-hygiene",
    uid: UID,
    folder: "nursing",
    size: 10,
    sha: "abc",
    ...overrides,
  };
}

function ok(result: ReturnType<typeof planNewFolder>) {
  expect(result, JSON.stringify(result)).not.toHaveProperty("error");
  return result as Exclude<typeof result, { error: string }>;
}

describe("making a folder", () => {
  test("leaves a placeholder, because git has no empty directories", () => {
    // The folder *is* the file. Without it a folder somebody made and has not
    // filed anything in yet would simply not exist until it stopped being
    // empty, which is not a filing system anybody would recognise.
    const plan = ok(planNewFolder({ folder: "Ward 3", existingFolders: [] }));
    expect(plan.operations).toEqual([
      { kind: "write", path: "ward-3/.gitkeep", base64Content: "" },
    ]);
  });

  test("nests as deep as anybody wants", () => {
    const plan = ok(
      planNewFolder({ folder: "clinical/nursing/ward-3", existingFolders: [] }),
    );
    expect(plan.operations[0]).toEqual({
      kind: "write",
      path: folderKeepPath("clinical/nursing/ward-3"),
      base64Content: "",
    });
  });

  test("refuses one the binder already has", () => {
    // "Make" would mean "nothing", and a change request that does nothing
    // merges cleanly and leaves somebody wondering what happened.
    expect(
      planNewFolder({ folder: "nursing", existingFolders: ["nursing"] }),
    ).toEqual({ error: "This binder already has a folder called “nursing”." });
  });

  test("refuses a name with nothing in it to make a path from", () => {
    expect(planNewFolder({ folder: "!!!", existingFolders: [] })).toEqual({
      error: "A folder needs a name with letters or numbers in it.",
    });
  });
});

describe("renaming a folder", () => {
  const paths = [
    `nursing/hand-hygiene.${UID}.md`,
    `nursing/handover.${OTHER}.md`,
    "nursing/.gitkeep",
  ];

  test("moves everything under it, one act", () => {
    // Twelve policies is twelve moves and exactly one change. A reviewer
    // should see it that way, and it must not be able to half-apply.
    const plan = ok(
      planFolderRename({
        from: "nursing",
        to: "infection-control",
        paths,
        existingFolders: ["nursing"],
      }),
    );
    expect(plan.operations).toEqual([
      {
        kind: "move",
        from: `nursing/hand-hygiene.${UID}.md`,
        to: `infection-control/hand-hygiene.${UID}.md`,
      },
      {
        kind: "move",
        from: `nursing/handover.${OTHER}.md`,
        to: `infection-control/handover.${OTHER}.md`,
      },
      // The placeholder moves too, or a folder somebody made and never filed
      // anything in could not be renamed at all.
      {
        kind: "move",
        from: "nursing/.gitkeep",
        to: "infection-control/.gitkeep",
      },
    ]);
  });

  test("refuses to write over something already there", () => {
    // Merging two folders is a thing somebody might want. Doing it by
    // accident, as the result of a typo in a rename, is not.
    const result = planFolderRename({
      from: "nursing",
      to: "clinical",
      paths: [...paths, `clinical/hand-hygiene.${UID}.md`],
      existingFolders: ["nursing", "clinical"],
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("write over it");
  });

  test("refuses to put two policies at one address", () => {
    // **The one the path check missed**, caught against a real Gitea. Two
    // policies of the same name have different identity segments, so their
    // filenames differ — and their addresses do not. A rename that put both at
    // `clinical/hand-hygiene` would leave a link resolving to whichever came
    // first.
    const result = planFolderRename({
      from: "nursing",
      to: "clinical",
      paths: [
        `nursing/hand-hygiene.${UID}.md`,
        `clinical/hand-hygiene.${OTHER}.md`,
      ],
      existingFolders: ["nursing", "clinical"],
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      "cannot share one address",
    );
  });

  test("refuses to move a folder inside itself", () => {
    // Git would take it. Every file would land under a path that is about to
    // stop existing, and nobody meant it.
    expect(
      planFolderRename({
        from: "nursing",
        to: "nursing/ward-3",
        paths,
        existingFolders: ["nursing"],
      }),
    ).toEqual({ error: "A folder cannot be moved inside itself." });
  });

  test("moves only the files that are actually there", () => {
    // **The bug this caught on a live stack.** The paths were reconstructed as
    // "every document, plus a placeholder in every folder" — which named a
    // `.gitkeep` in folders that have documents and no placeholder, and Gitea
    // refused to move a file that was never there. The tree's own blob list is
    // the only thing that knows.
    const plan = ok(
      planFolderRename({
        from: "training",
        to: "education",
        paths: [`training/hipaa.${UID}.json`],
        existingFolders: ["training"],
      }),
    );
    expect(plan.operations).toEqual([
      {
        kind: "move",
        from: `training/hipaa.${UID}.json`,
        to: `education/hipaa.${UID}.json`,
      },
    ]);
  });

  test("refuses a folder the binder does not have", () => {
    expect(
      planFolderRename({
        from: "missing",
        to: "found",
        paths,
        existingFolders: ["nursing"],
      }),
    ).toEqual({ error: "This binder has no folder called “missing”." });
  });
});

describe("renaming a document", () => {
  test("keeps the identity, which is what keeps the history", () => {
    // ADR 0005 in one assertion. Under ADR 0004 this was a new document
    // starting again at v1, with every tag it had orphaned behind it.
    const plan = ok(
      planDocumentRename({
        document: document(),
        name: "Hand Hygiene and PPE",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.operations).toEqual([
      {
        kind: "move",
        from: `nursing/hand-hygiene.${UID}.md`,
        to: `nursing/hand-hygiene-and-ppe.${UID}.md`,
      },
    ]);
  });

  test("files it somewhere else, keeping its name", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        folder: "Infection Control",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      to: `infection-control/hand-hygiene.${UID}.md`,
    });
    expect(plan.title).toContain("Move");
  });

  test("moves it to the binder's top level", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        folder: "",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.operations[0]).toMatchObject({ to: `hand-hygiene.${UID}.md` });
  });

  test("keeps the extension, because the bytes are not changing", () => {
    const plan = ok(
      planDocumentRename({
        document: document({ path: `nursing/hand-hygiene.${UID}.pdf` }),
        name: "Renamed",
        paths: [],
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      to: `nursing/renamed.${UID}.pdf`,
    });
  });

  test("refuses an address another document already answers to", () => {
    // A URL has to name one thing, or a link somebody sends is a coin toss.
    const result = planDocumentRename({
      document: document(),
      name: "Handover",
      paths: [`nursing/hand-hygiene.${UID}.md`, `nursing/handover.${OTHER}.md`],
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("already taken");
  });

  test("a folder's placeholder is not an address to collide with", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        name: "Gitkeep",
        paths: [`nursing/hand-hygiene.${UID}.md`, "nursing/.gitkeep"],
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      to: `nursing/gitkeep.${UID}.md`,
    });
  });

  test("refuses a document with no identity", () => {
    // Renaming it would lose a version history it does not have — the same
    // refusal publish makes, said where it is still actionable.
    const result = planDocumentRename({
      document: document({ uid: null, path: "nursing/NOTES.md" }),
      name: "Notes",
      paths: [],
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("not added through");
  });

  test("refuses a rename that changes nothing", () => {
    expect(
      planDocumentRename({
        document: document(),
        name: "Hand Hygiene",
        paths: [],
      }),
    ).toEqual({ error: "That is where it already is." });
  });
});

describe("what an act says it did", () => {
  // **These are not internal strings any more.** The commit subject is what a
  // draft reads back as, and what prefills the change request an author sends
  // to colleagues — so it is read by the people deciding, and it has to be in
  // their language. It used to be `Move nursing/hand-hygiene.01M2DJ….md to
  // nursing/hand-hygiene-and-ppe.01M2DJ….md`.

  test("a rename names the policy, not the file it is kept in", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        name: "Hand Hygiene and PPE",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    // "And" rather than "and": `formatDocumentName` title-cases every word,
    // including the joining ones. That is the rule the tree already draws with
    // and the one the version tags are stamped with, so this says what the
    // product actually says rather than what it should eventually say. Noted
    // in the handoff as outstanding — fixing it changes every title stamped
    // from here on, which is a decision about the record, not about wording.
    expect(plan.message).toBe("Rename Hand Hygiene to Hand Hygiene And PPE");
    // The title and the subject are one sentence: the act is the same act
    // whether it goes into a draft or opens a change request of its own.
    expect(plan.title).toBe(plan.message);
    expect(plan.message).not.toContain(UID);
  });

  test("refiling says where it went, in the folder's own words", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        folder: "Infection Control",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.message).toBe("Move Hand Hygiene to Infection Control");
  });

  test("the top level has a name, because “move it to ” does not", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        folder: "",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.message).toBe("Move Hand Hygiene to the binder’s top level");
  });

  test("renaming and refiling at once is one sentence, not two acts", () => {
    const plan = ok(
      planDocumentRename({
        document: document(),
        name: "Hand Hygiene and PPE",
        folder: "Clinical/Infection Control",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.message).toBe(
      "Rename Hand Hygiene to Hand Hygiene And PPE and move it to Clinical / Infection Control",
    );
  });

  test("an initialism survives the round trip through the slug", () => {
    // `formatDocumentName` is the same rule the version tags are stamped with,
    // so a policy called PPE is called PPE in the change request too.
    const plan = ok(
      planDocumentRename({
        document: document(),
        name: "PPE Guidance",
        paths: [`nursing/hand-hygiene.${UID}.md`],
      }),
    );
    expect(plan.message).toBe("Rename Hand Hygiene to PPE Guidance");
  });
});

describe("what a folder act says it did", () => {
  // Same reason as a document's: this is the sentence on the change request,
  // and `infection-control` is the storage format rather than the name
  // somebody typed. Half a change request in titles and half in slugs reads
  // worse than either alone.

  test("making a folder names it the way the tree will", () => {
    const plan = ok(
      planNewFolder({ folder: "Infection Control", existingFolders: [] }),
    );
    expect(plan.message).toBe("Add the folder Infection Control");
  });

  test("a nested folder says where it went", () => {
    const plan = ok(
      planNewFolder({ folder: "clinical/nursing", existingFolders: [] }),
    );
    expect(plan.message).toBe("Add the folder Clinical / Nursing");
  });

  test("renaming in place is a rename", () => {
    const plan = ok(
      planFolderRename({
        from: "infection-control",
        to: "Clinical Governance",
        paths: ["infection-control/handover.md"],
        existingFolders: ["infection-control"],
      }),
    );
    expect(plan.message).toBe(
      "Rename the folder Infection Control to Clinical Governance",
    );
  });

  test("moving under another folder is a move, not a rename", () => {
    // The name has not changed; where it lives has. Calling both "rename"
    // would tell a reviewer the wrong thing about what they are approving.
    const plan = ok(
      planFolderRename({
        from: "nursing",
        to: "clinical/nursing",
        paths: ["nursing/handover.md"],
        existingFolders: ["nursing"],
      }),
    );
    expect(plan.message).toBe("Move the folder Nursing to Clinical / Nursing");
  });
});

describe("archiving a document", () => {
  test("takes the file off the record and nothing else", () => {
    // One removal. Every version tag still points at the commit that held the
    // file, git never collects a commit reachable from a ref, and the bytes
    // stay readable from a bare clone at every version it reached. There is no
    // second branch to write to and no copy to make.
    const plan = ok(planDocumentArchive({ document: document() }));
    expect(plan.operations).toEqual([
      { kind: "remove", path: `nursing/hand-hygiene.${UID}.md` },
    ]);
  });

  test("says what it did in the customer's word", () => {
    // "Delete has connotations." It is also the wrong word: nothing is
    // destroyed, which is exactly what delete would have promised.
    const plan = ok(planDocumentArchive({ document: document() }));
    expect(plan.message).toBe("Archive Hand Hygiene");
    expect(plan.title).toBe(plan.message);
  });

  test("refuses a file with no identity, because that would be a deletion", () => {
    // Not about the tag. A file this product did not write has no version tags
    // at all, so removing it from `main` leaves no ref pointing at the commit
    // that held it — the one case where "archive" would be a lie.
    const result = planDocumentArchive({
      document: document({ uid: null, path: "README.md" }),
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain(
      "would be a deletion",
    );
  });
});

describe("restoring an archived document", () => {
  /** What the binder holds now. The archived document is not in it. */
  function tree(overrides: Partial<WorkspaceTree> = {}): WorkspaceTree {
    return {
      documents: [],
      folders: ["nursing"],
      paths: ["nursing/.gitkeep"],
      ...overrides,
    };
  }

  test("comes back at the filename it left with, so it keeps its identity", () => {
    // ADR 0005 in one assertion again, from the other direction: the identity
    // is a segment of the filename, this restores the filename, so the version
    // tags still match and the policy carries on rather than restarting at v1.
    const plan = ok(
      planDocumentRestore({
        document: document(),
        base64Content: "SGVsbG8=",
        tree: tree(),
      }),
    );
    expect(plan.operations).toEqual([
      {
        kind: "write",
        path: `nursing/hand-hygiene.${UID}.md`,
        base64Content: "SGVsbG8=",
      },
    ]);
    expect(plan.message).toBe("Restore Hand Hygiene");
  });

  test("lands at the top level when its folder is gone, and says so", () => {
    // The alternative is silently making the folder again, which is a second
    // act nobody asked for and which resurrects a filing decision somebody
    // deliberately undid.
    const plan = ok(
      planDocumentRestore({
        document: document(),
        base64Content: "SGVsbG8=",
        tree: tree({ folders: [], paths: [] }),
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      path: `hand-hygiene.${UID}.md`,
    });
    expect(plan.message).toBe("Restore Hand Hygiene to the binder’s top level");
  });

  test("a folder holding only other folders is still a folder", () => {
    // `clinical` is never named by a tree read when it holds nothing but
    // `clinical/nursing`, and a restore that ignored that would move a policy
    // to the top level for a reason nobody could see.
    const plan = ok(
      planDocumentRestore({
        document: document({
          folder: "clinical",
          path: `clinical/hand-hygiene.${UID}.md`,
          slugPath: "clinical/hand-hygiene",
        }),
        base64Content: "SGVsbG8=",
        tree: tree({ folders: [], paths: ["clinical/nursing/.gitkeep"] }),
      }),
    );
    expect(plan.operations[0]).toMatchObject({
      path: `clinical/hand-hygiene.${UID}.md`,
    });
  });

  test("refuses when something else has taken its address", () => {
    // Two documents at one address resolve to whichever came first, which is a
    // link somebody sends being a coin toss. The same refusal a rename makes.
    const result = planDocumentRestore({
      document: document(),
      base64Content: "SGVsbG8=",
      tree: tree({ paths: [`nursing/hand-hygiene.${OTHER}.md`] }),
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("already taken");
  });

  test("refuses one that is already in the binder", () => {
    // Not archived, so there is nothing to bring back — and writing it again
    // would propose a change that changes nothing.
    const result = planDocumentRestore({
      document: document(),
      base64Content: "SGVsbG8=",
      tree: tree({ documents: [document()] }),
    });
    expect(result).toEqual({ error: "That policy is already in this binder." });
  });

  test("a policy renamed since it left comes back under its last name", () => {
    // Its last published version is what is restored, so the name on that
    // version is the name it returns with — which is also the name the archive
    // listed it under, so nothing surprises anybody.
    const plan = ok(
      planDocumentRestore({
        document: document({
          name: "hand-hygiene-and-ppe",
          path: `nursing/hand-hygiene-and-ppe.${UID}.md`,
          slugPath: "nursing/hand-hygiene-and-ppe",
        }),
        base64Content: "SGVsbG8=",
        tree: tree(),
      }),
    );
    expect(plan.message).toBe("Restore Hand Hygiene And PPE");
  });
});
