import { describe, expect, test } from "bun:test";

import type { WorkspaceDocumentListEntry } from "../../packages/api-schema/schemas/workspaces";
import {
  ancestorFolders,
  buildBinderTree,
  folderPaths,
  type BinderTreeFolder,
  type BinderTreeNode,
} from "./binderTree";

function policy(
  slugPath: string,
  overrides: Partial<WorkspaceDocumentListEntry> = {},
): WorkspaceDocumentListEntry {
  const cut = slugPath.lastIndexOf("/");
  return {
    path: `${slugPath}.01J8XZ4K7MQ9V3B0RN7YHS2E1D.md`,
    slugPath,
    name: cut === -1 ? slugPath : slugPath.slice(cut + 1),
    folder: cut === -1 ? "" : slugPath.slice(0, cut),
    size: 100,
    sha: "abc",
    state: "published",
    openChangeCount: 0,
    latestVersion: null,
    ...overrides,
  } as WorkspaceDocumentListEntry;
}

/** The tree as a readable outline, so a test asserts shape rather than nesting. */
function outline(nodes: readonly BinderTreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [
          `${"  ".repeat(depth)}[${node.name}] ${node.documentCount}`,
          ...outline(node.children, depth + 1),
        ]
      : [`${"  ".repeat(depth)}${node.document.name}`],
  );
}

function folderNamed(
  nodes: readonly BinderTreeNode[],
  path: string,
): BinderTreeFolder | null {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.path === path) return node;
    const found = folderNamed(node.children, path);
    if (found) return found;
  }
  return null;
}

describe("what a binder looks like as a tree", () => {
  test("folders nest instead of sitting side by side", () => {
    // The bug this replaces: `nursing/infection` was a heading next to
    // `nursing`, with nothing saying one was inside the other.
    const tree = buildBinderTree([
      policy("nursing/infection/handover"),
      policy("nursing/hand-hygiene"),
      policy("handbook"),
    ]);

    expect(outline(tree)).toEqual([
      "[nursing] 2",
      "  [infection] 1",
      "    handover",
      "  hand-hygiene",
      "handbook",
    ]);
  });

  test("folders come before documents, each alphabetically", () => {
    const tree = buildBinderTree([
      policy("zebra"),
      policy("alpha"),
      policy("pharmacy/one"),
      policy("estates/two"),
    ]);

    expect(outline(tree)).toEqual([
      "[estates] 1",
      "  two",
      "[pharmacy] 1",
      "  one",
      "alpha",
      "zebra",
    ]);
  });

  test("an empty folder is in the tree, because the binder says it exists", () => {
    // "Folders are real, empty or not." A folder holds a `.gitkeep` and no
    // document, so reading folders off the documents made one somebody had
    // approved and published invisible.
    const tree = buildBinderTree([], ["nursing", "pharmacy"]);

    expect(outline(tree)).toEqual(["[nursing] 0", "[pharmacy] 0"]);
  });

  test("a folder that holds only folders still connects them", () => {
    // `nursing` is named by nothing — no document is filed directly in it and
    // the tree read may not name it either. Without inferring it, `infection`
    // is an orphan whose parent does not exist, and it renders nowhere.
    const tree = buildBinderTree(
      [policy("nursing/infection/handover")],
      ["nursing/infection"],
    );

    expect(outline(tree)).toEqual([
      "[nursing] 1",
      "  [infection] 1",
      "    handover",
    ]);
  });

  test("a folder counts everything below it, not only what it holds", () => {
    // A collapsed folder has to say what it is hiding, and the answer is not
    // "nothing" when twelve policies are two levels down.
    const tree = buildBinderTree([
      policy("nursing/infection/handover"),
      policy("nursing/infection/ppe"),
      policy("nursing/hand-hygiene"),
    ]);

    expect(folderNamed(tree, "nursing")?.documentCount).toBe(3);
    expect(folderNamed(tree, "nursing/infection")?.documentCount).toBe(2);
  });

  test("a folder named twice is one folder", () => {
    // The tree read names it and a document implies it. They are the same
    // node, or the binder shows the folder twice.
    const tree = buildBinderTree([policy("nursing/hand-hygiene")], ["nursing"]);

    expect(outline(tree)).toEqual(["[nursing] 1", "  hand-hygiene"]);
  });

  test("case does not split a folder's neighbours apart", () => {
    const tree = buildBinderTree([], ["Pharmacy", "estates", "Nursing"]);

    expect(outline(tree)).toEqual([
      "[estates] 0",
      "[Nursing] 0",
      "[Pharmacy] 0",
    ]);
  });

  test("an empty binder is an empty tree, not a broken one", () => {
    expect(buildBinderTree([], [])).toEqual([]);
  });
});

describe("reaching into a tree", () => {
  test("every folder path, in the order the page reads", () => {
    const tree = buildBinderTree(
      [policy("nursing/infection/handover")],
      ["pharmacy"],
    );

    expect(folderPaths(tree)).toEqual([
      "nursing",
      "nursing/infection",
      "pharmacy",
    ]);
  });

  test("revealing a document opens its ancestors, not itself", () => {
    // Landing on a policy three levels down with every folder shut shows an
    // empty pane and no clue why.
    expect(ancestorFolders("nursing/infection")).toEqual([
      "nursing",
      "nursing/infection",
    ]);
    expect(ancestorFolders("")).toEqual([]);
  });
});
