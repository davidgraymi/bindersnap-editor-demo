/**
 * A change that cannot be brought up to date, and the way through it.
 *
 * **What a conflict is here.** A change branches off `main`; other changes are
 * published; "Bring up to date" merges `main` into the change's branch. When a
 * document was changed on both sides since the branch began, git cannot merge
 * it on its own — and for the Word files and PDFs most policies are, it cannot
 * even try. Until now that was a dead end: Gitea's message, and no way
 * forward from inside the product.
 *
 * **Git has the three versions; a person picks.** Every document that both the
 * change and the binder touched since the change began is read at three
 * points — where the change started (the merge base), the change's own
 * version, and the version published since — and the person resolving it says
 * what the result should be. That decision is the one thing git cannot make.
 *
 * **Paired by identity, not by address.** A document's identity is a segment of
 * its filename (ADR 0005), so a policy renamed on one side and edited on the
 * other is still one policy. Pairing by path would call that a deletion
 * conflicting with an edit, which is the wrong question to put to a person —
 * and one git's own rename detection answers without asking.
 *
 * **How the resolution lands, with nothing but Gitea's API.** Gitea cannot
 * write a merge commit with contents somebody chose. It can write ordinary
 * commits, and it can merge. So resolving is three steps on the change's
 * branch:
 *
 * 1. For each conflicting document, make the branch agree with what was
 *    published. Both sides now say the same thing about it, so —
 * 2. the ordinary "bring up to date" merge goes through, and then
 * 3. one more commit writes what the person chose.
 *
 * The history reads as it happened: the published version taken, `main`
 * merged, and the author's resolution on top, under their name. If the merge
 * in step 2 fails anyway, step 1 is undone with a commit restoring the change's
 * own versions, so a failed resolution leaves the change as it found it.
 */

import { parseDocumentFilename } from "../../../packages/utils/documentPath";
import { unwrap, type GiteaClient } from "./client";
import { commitBinderFiles, type BinderFileOperation } from "./binderFiles";
import { updateChangeBranch } from "./pullRequests";

/** One side's copy of a file: where it is, and which blob. */
export interface ConflictSide {
  path: string;
  sha: string;
}

/** A file both sides changed, read at the three points that matter. */
export interface ConflictingFile {
  /** Stable across the three trees: the identity, or the path without one. */
  key: string;
  base: ConflictSide | null;
  ours: ConflictSide | null;
  theirs: ConflictSide | null;
  /**
   * Where the result goes. A move on one side is kept; a move on both keeps
   * the change's, because the change is what is being proposed.
   */
  path: string;
  /**
   * What to do without asking, when there is an answer.
   *
   * A document moved on one side and edited on the other has one: the edit,
   * at the new address. Null means the two sides changed the same thing in
   * different ways, which only a person can decide.
   */
  automatic: "ours" | "theirs" | null;
}

/** path → blob sha, for every file in a tree. */
export type TreeBlobs = ReadonlyMap<string, string>;

interface TreeEntry {
  path?: string;
  type?: string;
  sha?: string;
}

/** Every blob in the tree at `sha`, by path. */
export async function readTreeBlobs(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  sha: string;
}): Promise<Map<string, string>> {
  const { client, org, workspace, sha } = params;
  const blobs = new Map<string, string>();

  // Gitea pages a large recursive tree. A binder is dozens of files, so this
  // is one page in practice — but a silently truncated tree would miss a
  // conflict, so it reads until Gitea says it is done.
  for (let page = 1; page <= 50; page += 1) {
    const tree = (await unwrap(
      client.GET("/repos/{owner}/{repo}/git/trees/{sha}", {
        params: {
          path: { owner: org, repo: workspace, sha },
          query: { recursive: true, page, per_page: 1000 },
        },
      }),
    )) as { tree?: TreeEntry[]; truncated?: boolean };

    for (const entry of tree.tree ?? []) {
      if (entry.type === "blob" && entry.path && entry.sha) {
        blobs.set(entry.path, entry.sha);
      }
    }
    if (!tree.truncated) break;
  }

  return blobs;
}

/** The identity a path carries, or the path itself when it carries none. */
export function conflictKey(path: string): string {
  const filename = path.split("/").pop() ?? path;
  const { uid } = parseDocumentFilename(filename);
  return uid ? `uid:${uid}` : `path:${path}`;
}

function byKey(tree: TreeBlobs): Map<string, ConflictSide> {
  const sides = new Map<string, ConflictSide>();
  for (const [path, sha] of [...tree.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const key = conflictKey(path);
    // Two files claiming one identity is a binder edited outside Bindersnap.
    // The first by path wins, deterministically, rather than whichever the
    // map happened to hold.
    if (!sides.has(key)) sides.set(key, { path, sha });
  }
  return sides;
}

function same(a: ConflictSide | null, b: ConflictSide | null): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.sha === b.sha;
}

/**
 * Every file the change and the binder both changed since the change began,
 * and changed differently.
 *
 * Pure, so the rules — what counts as both sides, what can be settled without
 * asking — are testable without a Gitea.
 */
export function findConflictingFiles(
  base: TreeBlobs,
  ours: TreeBlobs,
  theirs: TreeBlobs,
): ConflictingFile[] {
  const baseSides = byKey(base);
  const ourSides = byKey(ours);
  const theirSides = byKey(theirs);
  const keys = new Set([
    ...baseSides.keys(),
    ...ourSides.keys(),
    ...theirSides.keys(),
  ]);

  const conflicts: ConflictingFile[] = [];
  for (const key of keys) {
    const b = baseSides.get(key) ?? null;
    const o = ourSides.get(key) ?? null;
    const t = theirSides.get(key) ?? null;

    // Changed on one side only, or the same way on both: git merges it.
    if (same(o, b) || same(t, b) || same(o, t)) continue;

    const oursMoved = o !== null && b !== null && o.path !== b.path;
    const theirsMoved = t !== null && b !== null && t.path !== b.path;
    const oursEdited = o === null || b === null || o.sha !== b.sha;
    const theirsEdited = t === null || b === null || t.sha !== b.sha;

    const path =
      o === null
        ? t!.path
        : t === null
          ? o.path
          : oursMoved || !theirsMoved
            ? o.path
            : t.path;

    // One side only moved it and the other only edited it: both hold, and
    // there is nothing to ask.
    const automatic =
      o !== null && t !== null && !oursEdited
        ? "theirs"
        : o !== null && t !== null && !theirsEdited
          ? "ours"
          : null;

    conflicts.push({ key, base: b, ours: o, theirs: t, path, automatic });
  }

  return conflicts.sort((a, b) => a.path.localeCompare(b.path));
}

/** One file's bytes, as base64, by blob sha. */
export async function readBlob(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  sha: string;
}): Promise<{ base64: string; size: number }> {
  const { client, org, workspace, sha } = params;
  const blob = (await unwrap(
    client.GET("/repos/{owner}/{repo}/git/blobs/{sha}", {
      params: { path: { owner: org, repo: workspace, sha } },
    }),
  )) as { content?: string; size?: number; encoding?: string };
  // Gitea wraps base64 at 76 columns, as git does; a browser's atob does not
  // mind, but a caller comparing two encodings would.
  return {
    base64: (blob.content ?? "").replace(/\s+/g, ""),
    size: blob.size ?? 0,
  };
}

/** What the person resolving decided for one file. */
export type FileResolution =
  | { key: string; take: "ours" | "theirs" }
  /** Neither side: the document goes. */
  | { key: string; take: "none" }
  /** Something they put together — a merge of the two, in practice. */
  | { key: string; take: "content"; base64Content: string };

/** The operations that make the branch hold `to` where it held `from`. */
function operationsFor(
  from: { path: string } | null,
  to: { path: string; base64Content: string } | null,
): BinderFileOperation[] {
  const operations: BinderFileOperation[] = [];
  if (from && (!to || to.path !== from.path)) {
    operations.push({ kind: "remove", path: from.path });
  }
  if (to) {
    operations.push({
      kind: "write",
      path: to.path,
      base64Content: to.base64Content,
    });
  }
  return operations;
}

export class ConflictResolutionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ConflictResolutionError";
  }
}

/**
 * Resolve the change's conflicts as decided, and bring it up to date.
 *
 * `conflicts` is what {@link findConflictingFiles} answered for the heads the
 * caller has just checked are still current; every one that needs a person
 * has to have a decision in `resolutions`, and a decision for one that does
 * not overrides the automatic answer.
 */
export async function resolveChangeConflicts(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  pullNumber: number;
  branch: string;
  conflicts: readonly ConflictingFile[];
  resolutions: readonly FileResolution[];
  /** Whose resolution it is, for the commit message. */
  username: string;
}): Promise<{ caughtUp: boolean }> {
  const { client, org, workspace, pullNumber, branch, conflicts, username } =
    params;
  const decided = new Map(
    params.resolutions.map((entry) => [entry.key, entry]),
  );

  const undecided = conflicts.filter(
    (conflict) => conflict.automatic === null && !decided.has(conflict.key),
  );
  if (undecided.length > 0) {
    throw new ConflictResolutionError(
      400,
      `Decide what happens to ${undecided.map((c) => c.path).join(", ")} first.`,
    );
  }
  const unknown = params.resolutions.filter(
    (entry) => !conflicts.some((conflict) => conflict.key === entry.key),
  );
  if (unknown.length > 0) {
    throw new ConflictResolutionError(
      409,
      "The conflicts have changed since this page was opened. Reload it and resolve them again.",
    );
  }

  const read = (sha: string) =>
    readBlob({ client, org, workspace, sha }).then((blob) => blob.base64);

  // Every file's final state, worked out before anything is written, so a
  // failed read changes nothing.
  const plans = await Promise.all(
    conflicts.map(async (conflict) => {
      const decision: FileResolution["take"] =
        decided.get(conflict.key)?.take ?? conflict.automatic!;
      const choice = decided.get(conflict.key);

      let final: { path: string; base64Content: string } | null;
      if (decision === "none") {
        final = null;
      } else if (decision === "content" && choice?.take === "content") {
        final = { path: conflict.path, base64Content: choice.base64Content };
      } else {
        const side = decision === "ours" ? conflict.ours : conflict.theirs;
        final = side
          ? { path: conflict.path, base64Content: await read(side.sha) }
          : null;
      }

      return {
        conflict,
        final,
        ours: conflict.ours
          ? {
              path: conflict.ours.path,
              base64Content: await read(conflict.ours.sha),
            }
          : null,
        theirs: conflict.theirs
          ? {
              path: conflict.theirs.path,
              base64Content: await read(conflict.theirs.sha),
            }
          : null,
      };
    }),
  );

  // 1. The branch agrees with what was published, for these files only.
  const takeTheirs = plans.flatMap((plan) =>
    operationsFor(plan.ours, plan.theirs),
  );
  const count = plans.length;
  const noun = count === 1 ? "document" : "documents";
  await commitBinderFiles({
    client,
    org,
    workspace,
    branch,
    operations: takeTheirs,
    message: `Take the published version of ${count} ${noun} before bringing the change up to date`,
  });

  // 2. So the merge has nothing left to disagree about.
  let caughtUp: boolean;
  try {
    caughtUp = await updateChangeBranch({
      client,
      owner: org,
      repo: workspace,
      pullNumber,
    });
  } catch (err) {
    // Put the change's own versions back, so a failed resolution leaves the
    // change as it was found rather than half-way through.
    const restore = plans.flatMap((plan) =>
      operationsFor(plan.theirs, plan.ours),
    );
    await commitBinderFiles({
      client,
      org,
      workspace,
      branch,
      operations: restore,
      message: `Restore the change's own version of ${count} ${noun}`,
    }).catch(() => undefined);
    throw err;
  }

  // 3. What the person decided, on top. Nothing to write for a file where
  //    they chose exactly what was published.
  const resolve = plans.flatMap((plan) =>
    plan.final &&
    plan.theirs &&
    plan.final.path === plan.theirs.path &&
    plan.final.base64Content === plan.theirs.base64Content
      ? []
      : !plan.final && !plan.theirs
        ? []
        : operationsFor(plan.theirs, plan.final),
  );
  if (resolve.length > 0) {
    await commitBinderFiles({
      client,
      org,
      workspace,
      branch,
      operations: resolve,
      message: [
        `Resolve conflicts with the published binder`,
        "",
        ...plans.map(
          (plan) =>
            `- ${plan.conflict.path}: ${describeDecision(
              decided.get(plan.conflict.key)?.take ?? plan.conflict.automatic!,
            )}`,
        ),
        "",
        `Resolved by: ${username}`,
      ].join("\n"),
    });
  }

  return { caughtUp };
}

function describeDecision(take: FileResolution["take"]): string {
  switch (take) {
    case "ours":
      return "kept this change's version";
    case "theirs":
      return "kept the published version";
    case "none":
      return "removed";
    case "content":
      return "combined both versions";
  }
}
