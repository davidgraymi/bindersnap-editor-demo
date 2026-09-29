import type { ConflictingFilePayload } from "../../packages/api-schema/schemas/workspaces";
import { parseDocumentFilename } from "../../packages/utils/documentPath";
import type { ConflictResolution } from "./api";
import {
  applyChoices,
  base64ToText,
  countConflicts,
  joinLines,
  mergeThreeWay,
  parseEditorDocumentJson,
  sameBlock,
  splitLines,
  textToBase64,
  type ConflictChoice,
  type EditorDocument,
  type MergeChunk,
} from "./threeWayMerge";

/**
 * What the conflict page decides, without the page.
 *
 * For each file both sides changed: whether it can be merged a piece at a time
 * (a document the editor wrote, block by block; a text file, line by line) or
 * only chosen whole (a Word file, a PDF, a removal against an edit), what its
 * badge says, and — once every choice is made — what goes back to the server.
 */

/** `nursing/hand-hygiene.01J8….json` → `nursing/hand-hygiene.json`. */
export function displayConflictPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash + 1);
  const { name, extension } = parseDocumentFilename(path.slice(slash + 1));
  return `${folder}${name}${extension ? `.${extension}` : ""}`;
}

/** What happened to a file on each side, as the badge in its bar says it. */
export function describeConflictFile(file: ConflictingFilePayload): string {
  if (file.automatic) return "Settled automatically";
  if (file.ours === null) return "Removed in this change, edited in the binder";
  if (file.theirs === null)
    return "Edited in this change, removed in the binder";
  if (file.base === null) return "Added on both sides";
  return "Edited on both sides";
}

export type FileMerge =
  /** Merged a piece at a time; `chunks` holds what settled and what did not. */
  | {
      mode: "pieces";
      format: "editor";
      chunks: MergeChunk<unknown>[];
      /** The change's version of the whole document, for everything but its blocks. */
      document: EditorDocument;
      theirsText: string;
      oursText: string;
    }
  | {
      mode: "pieces";
      format: "text";
      chunks: MergeChunk<string>[];
      theirsText: string;
      oursText: string;
    }
  /** Only one version or the other, whole. */
  | { mode: "whole"; reason: WholeReason };

export type WholeReason =
  "automatic" | "removed" | "binary" | "too-large" | "unreadable";

/** How this file can be merged, worked out from the bytes the server sent. */
export function planFileMerge(file: ConflictingFilePayload): FileMerge {
  if (file.automatic) return { mode: "whole", reason: "automatic" };
  if (file.ours === null || file.theirs === null) {
    return { mode: "whole", reason: "removed" };
  }
  if (file.kind === "binary") return { mode: "whole", reason: "binary" };
  const sides = [file.base, file.ours, file.theirs];
  if (sides.some((side) => side !== null && side.content === null)) {
    return { mode: "whole", reason: "too-large" };
  }

  const base = file.base?.content ? base64ToText(file.base.content) : "";
  const ours = base64ToText(file.ours.content!);
  const theirs = base64ToText(file.theirs.content!);

  if (file.kind === "editor") {
    const baseDoc = file.base
      ? parseEditorDocumentJson(base)
      : { type: "doc" as const, content: [] };
    const oursDoc = parseEditorDocumentJson(ours);
    const theirsDoc = parseEditorDocumentJson(theirs);
    if (baseDoc && oursDoc && theirsDoc) {
      return {
        mode: "pieces",
        format: "editor",
        chunks: mergeThreeWay(
          baseDoc.content ?? [],
          oursDoc.content ?? [],
          theirsDoc.content ?? [],
          sameBlock,
        ),
        document: oursDoc,
        oursText: ours,
        theirsText: theirs,
      };
    }
    // A `.json` that is not the editor's is data, and data merges by line.
  }

  return {
    mode: "pieces",
    format: "text",
    chunks: mergeThreeWay(
      splitLines(base),
      splitLines(ours),
      splitLines(theirs),
    ),
    oursText: ours,
    theirsText: theirs,
  };
}

/** Each file's state on the page: a whole choice, or one per conflict. */
export interface FileDecision {
  whole: "ours" | "theirs" | "none" | null;
  pieces: (ConflictChoice | null)[];
}

export function emptyDecision(merge: FileMerge): FileDecision {
  return {
    whole: null,
    pieces:
      merge.mode === "pieces"
        ? new Array<ConflictChoice | null>(countConflicts(merge.chunks)).fill(
            null,
          )
        : [],
  };
}

/** Whether a file still needs somebody to decide something. */
export function isDecided(merge: FileMerge, decision: FileDecision): boolean {
  if (decision.whole !== null) return true;
  if (merge.mode === "whole") return merge.reason === "automatic";
  return decision.pieces.every((choice) => choice !== null);
}

/**
 * What goes back to the server for one file, or null for nothing to send —
 * a file that settled itself, or one not decided yet.
 *
 * A merge that came out identical to one side is sent as that side rather
 * than as bytes: the server then writes nothing for a file where somebody
 * chose exactly what was published.
 */
export function toResolution(
  file: ConflictingFilePayload,
  merge: FileMerge,
  decision: FileDecision,
): ConflictResolution | null {
  if (decision.whole) return { key: file.key, take: decision.whole };
  if (merge.mode === "whole") return null;

  const merged = applyChoices<unknown>(
    merge.chunks as MergeChunk<unknown>[],
    decision.pieces,
  );
  if (merged === null) return null;

  const text =
    merge.format === "editor"
      ? JSON.stringify({ ...merge.document, content: merged }, null, 2)
      : joinLines(merged as string[]);

  if (sameContent(text, merge.theirsText, merge.format)) {
    return { key: file.key, take: "theirs" };
  }
  if (sameContent(text, merge.oursText, merge.format)) {
    return { key: file.key, take: "ours" };
  }
  return { key: file.key, take: "content", base64Content: textToBase64(text) };
}

function sameContent(a: string, b: string, format: "editor" | "text"): boolean {
  if (format === "text") return a === b;
  // The editor's JSON is compared as a document, not as its spacing.
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a === b;
  }
}
