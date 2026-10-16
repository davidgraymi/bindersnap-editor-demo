import { describe, expect, test } from "bun:test";

import type { ConflictingFilePayload } from "../../packages/api-schema/schemas/workspaces";
import {
  describeConflictFile,
  displayConflictPath,
  emptyDecision,
  isDecided,
  planFileMerge,
  toResolution,
} from "./conflictResolution";
import { base64ToText, textToBase64 } from "./threeWayMerge";

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const PATH = `nursing/hand-hygiene.${UID}.json`;

const para = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...paragraphs: string[]) =>
  textToBase64(JSON.stringify({ type: "doc", content: paragraphs.map(para) }));
const side = (content: string | null) => ({ path: PATH, size: 10, content });

function file(
  overrides: Partial<ConflictingFilePayload>,
): ConflictingFilePayload {
  return {
    key: `uid:${UID}`,
    path: PATH,
    kind: "editor",
    automatic: null,
    base: side(doc("Scope", "Clean hands", "Training", "Records")),
    ours: side(doc("Scope", "Clean hands with soap", "Training", "Records")),
    theirs: side(
      doc("Scope", "Clean hands with rub", "Training", "Records kept 7 years"),
    ),
    ...overrides,
  };
}

describe("what the page says about a file", () => {
  test("the path is read without its identity", () => {
    expect(displayConflictPath(PATH)).toBe("nursing/hand-hygiene.json");
    expect(displayConflictPath(".gitea/CODEOWNERS")).toBe(".gitea/CODEOWNERS");
  });

  test("the badge says what happened on each side", () => {
    expect(describeConflictFile(file({}))).toBe("Edited on both sides");
    expect(describeConflictFile(file({ ours: null }))).toBe(
      "Removed in this change, edited in the binder",
    );
    expect(describeConflictFile(file({ automatic: "ours" }))).toBe(
      "Settled automatically",
    );
  });
});

describe("merging a document the editor wrote", () => {
  test("merges block by block, and only the paragraph both changed is asked about", () => {
    const merge = planFileMerge(file({}));
    expect(merge.mode).toBe("pieces");
    if (merge.mode !== "pieces") return;
    expect(merge.format).toBe("editor");
    expect(
      merge.chunks.filter((chunk) => chunk.kind === "conflict"),
    ).toHaveLength(1);

    const decision = emptyDecision(merge);
    expect(isDecided(merge, decision)).toBe(false);
    decision.pieces[0] = "ours";
    expect(isDecided(merge, decision)).toBe(true);

    const resolution = toResolution(file({}), merge, decision);
    expect(resolution?.take).toBe("content");
    const merged = JSON.parse(base64ToText(resolution!.base64Content!));
    // The change's wording, and the binder's new Records paragraph.
    expect(
      merged.content.map(
        (block: { content: [{ text: string }] }) => block.content[0].text,
      ),
    ).toEqual([
      "Scope",
      "Clean hands with soap",
      "Training",
      "Records kept 7 years",
    ]);
  });

  test("a merge that comes out as the published version is sent as that", () => {
    const f = file({
      theirs: side(doc("Scope", "Clean hands with rub", "Training", "Records")),
    });
    const merge = planFileMerge(f);
    const decision = emptyDecision(merge);
    decision.pieces[0] = "theirs";
    expect(toResolution(f, merge, decision)).toEqual({
      key: f.key,
      take: "theirs",
    });
  });

  test("a JSON file that is not the editor's merges line by line", () => {
    const merge = planFileMerge(
      file({
        base: side(textToBase64("a\nb")),
        ours: side(textToBase64("a\nB")),
        theirs: side(textToBase64("A\nb")),
      }),
    );
    expect(merge.mode === "pieces" && merge.format).toBe("text");
  });
});

describe("files chosen whole", () => {
  test("a Word file, a removal, a file too big to send, and one that settled itself", () => {
    expect(planFileMerge(file({ kind: "binary" }))).toEqual({
      mode: "whole",
      reason: "binary",
    });
    expect(planFileMerge(file({ theirs: null }))).toEqual({
      mode: "whole",
      reason: "removed",
    });
    expect(planFileMerge(file({ ours: side(null) }))).toEqual({
      mode: "whole",
      reason: "too-large",
    });
    const automatic = planFileMerge(file({ automatic: "theirs" }));
    expect(isDecided(automatic, emptyDecision(automatic))).toBe(true);
    expect(
      toResolution(
        file({ automatic: "theirs" }),
        automatic,
        emptyDecision(automatic),
      ),
    ).toBeNull();
  });

  test("a whole choice wins over pieces", () => {
    const f = file({});
    const merge = planFileMerge(f);
    expect(toResolution(f, merge, { whole: "none", pieces: [null] })).toEqual({
      key: f.key,
      take: "none",
    });
  });
});
