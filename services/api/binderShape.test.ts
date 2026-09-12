import { describe, expect, test } from "bun:test";

import { folderKeepPath, planFolderRename, planNewFolder } from "./binderShape";

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
