import { diffArrays } from "diff";

/**
 * Merging two versions of a document against the one they both started from.
 *
 * **git's diff3, over the pieces a person would name.** A policy written in
 * the editor is a list of blocks — headings, paragraphs, tables — so it is
 * merged a block at a time: one side rewrote the Scope section and the other
 * added a paragraph to Records, and both land without asking anybody. Text
 * files merge a line at a time. What is left over is the handful of places
 * where both sides changed the same thing in different ways, and those are
 * put to the person resolving, side by side, one at a time.
 *
 * No DOM and no network, so every rule here is testable on its own.
 */

/** A run of the merged document: settled, or a place both sides changed. */
export type MergeChunk<T> =
  | { kind: "settled"; items: T[] }
  | { kind: "conflict"; base: T[]; ours: T[]; theirs: T[] };

/**
 * For each item of `base`, where it sits in `other` — or -1 where `other`
 * changed or removed it.
 */
function matchAgainst<T>(
  base: readonly T[],
  other: readonly T[],
  equal: (a: T, b: T) => boolean,
): number[] {
  const matches = new Array<number>(base.length).fill(-1);
  let b = 0;
  let o = 0;
  for (const part of diffArrays(base as T[], other as T[], {
    comparator: equal,
  })) {
    const count = part.count ?? part.value.length;
    if (part.added) {
      o += count;
    } else if (part.removed) {
      b += count;
    } else {
      for (let index = 0; index < count; index += 1) {
        matches[b + index] = o + index;
      }
      b += count;
      o += count;
    }
  }
  return matches;
}

function sameRun<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean,
): boolean {
  return (
    a.length === b.length && a.every((item, index) => equal(item, b[index]!))
  );
}

/**
 * The three-way merge: runs that settle themselves, and conflicts.
 *
 * Between two items all three versions agree on, whatever changed changed on
 * one side (take it), on both the same way (take it once), or on both
 * differently (a conflict). That is the whole of diff3.
 */
export function mergeThreeWay<T>(
  base: readonly T[],
  ours: readonly T[],
  theirs: readonly T[],
  equal: (a: T, b: T) => boolean = (a, b) => a === b,
): MergeChunk<T>[] {
  const inOurs = matchAgainst(base, ours, equal);
  const inTheirs = matchAgainst(base, theirs, equal);
  const chunks: MergeChunk<T>[] = [];

  const settle = (items: T[]) => {
    if (items.length === 0) return;
    const last = chunks[chunks.length - 1];
    if (last?.kind === "settled") last.items.push(...items);
    else chunks.push({ kind: "settled", items: [...items] });
  };

  let b = 0;
  let o = 0;
  let t = 0;
  while (b <= base.length) {
    // The next item of the base that both sides kept, at or after where each
    // side has got to — the next point all three agree on.
    let anchor = b;
    while (
      anchor < base.length &&
      !(inOurs[anchor]! >= o && inTheirs[anchor]! >= t)
    ) {
      anchor += 1;
    }
    const oursTo = anchor < base.length ? inOurs[anchor]! : ours.length;
    const theirsTo = anchor < base.length ? inTheirs[anchor]! : theirs.length;

    const baseRun = base.slice(b, anchor);
    const oursRun = ours.slice(o, oursTo);
    const theirsRun = theirs.slice(t, theirsTo);

    if (sameRun(oursRun, baseRun, equal)) settle(theirsRun);
    else if (sameRun(theirsRun, baseRun, equal)) settle(oursRun);
    else if (sameRun(oursRun, theirsRun, equal)) settle(oursRun);
    else {
      chunks.push({
        kind: "conflict",
        base: baseRun,
        ours: oursRun,
        theirs: theirsRun,
      });
    }

    if (anchor === base.length) break;
    settle([base[anchor]!]);
    b = anchor + 1;
    o = oursTo + 1;
    t = theirsTo + 1;
  }

  return refineConflicts(chunks, equal);
}

/**
 * git's "zealous" merge: what both sides of a conflict say alike is not in
 * conflict.
 *
 * diff3 only knows the anchors all three versions share, so a policy both
 * sides added — no base at all — came back as one conflict the length of the
 * document, with the title and every paragraph the two agree on inside it.
 * Diffing the two sides of each conflict against each other settles what
 * they share, and leaves only the places they actually differ to be asked
 * about.
 */
function refineConflicts<T>(
  chunks: MergeChunk<T>[],
  equal: (a: T, b: T) => boolean,
): MergeChunk<T>[] {
  const out: MergeChunk<T>[] = [];
  const settle = (items: T[]) => {
    if (items.length === 0) return;
    const last = out[out.length - 1];
    if (last?.kind === "settled") last.items.push(...items);
    else out.push({ kind: "settled", items: [...items] });
  };

  for (const chunk of chunks) {
    if (chunk.kind === "settled") {
      settle(chunk.items);
      continue;
    }
    const pieces: MergeChunk<T>[] = [];
    let ours: T[] = [];
    let theirs: T[] = [];
    const flush = () => {
      if (ours.length === 0 && theirs.length === 0) return;
      pieces.push({ kind: "conflict", base: [], ours, theirs });
      ours = [];
      theirs = [];
    };
    for (const part of diffArrays(chunk.ours, chunk.theirs, {
      comparator: equal,
    })) {
      if (part.removed) ours = ours.concat(part.value);
      else if (part.added) theirs = theirs.concat(part.value);
      else {
        flush();
        pieces.push({ kind: "settled", items: part.value });
      }
    }
    flush();

    const conflicts = pieces.filter((piece) => piece.kind === "conflict");
    // One clash left is the clash diff3 found, and keeps its base.
    if (conflicts.length === 1) conflicts[0]!.base = chunk.base;
    for (const piece of pieces) {
      if (piece.kind === "settled") settle(piece.items);
      else out.push(piece);
    }
  }
  return out;
}

/** How one conflict was decided. */
export type ConflictChoice = "ours" | "theirs" | "both" | "neither";

/**
 * The merged document, given a choice for each conflict in order.
 *
 * "Both" is the change's side first, then the published one — the order a
 * reader expects, since the change is what is being proposed on top.
 */
export function applyChoices<T>(
  chunks: readonly MergeChunk<T>[],
  choices: readonly (ConflictChoice | null)[],
): T[] | null {
  const out: T[] = [];
  let conflictIndex = 0;
  for (const chunk of chunks) {
    if (chunk.kind === "settled") {
      out.push(...chunk.items);
      continue;
    }
    const choice = choices[conflictIndex];
    conflictIndex += 1;
    if (!choice) return null;
    if (choice === "ours" || choice === "both") out.push(...chunk.ours);
    if (choice === "theirs" || choice === "both") out.push(...chunk.theirs);
  }
  return out;
}

export function countConflicts<T>(chunks: readonly MergeChunk<T>[]): number {
  return chunks.filter((chunk) => chunk.kind === "conflict").length;
}

/* ─── The two kinds of file this merges ──────────────────────────────── */

/** A document the editor wrote: its top-level blocks, and the rest of it. */
export interface EditorDocument {
  type: "doc";
  content?: unknown[];
  [key: string]: unknown;
}

export function parseEditorDocumentJson(text: string): EditorDocument | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "doc"
    ) {
      return parsed as EditorDocument;
    }
  } catch {
    // Not the editor's; the caller falls back to lines.
  }
  return null;
}

/** Blocks are equal when their JSON is — attributes and marks included. */
export const sameBlock = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Lines, keeping whether the file ended with a newline. */
export function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

export function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

/* ─── base64, for the bytes the server sends and takes ───────────────── */

export function base64ToText(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, type = ""): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type });
}
