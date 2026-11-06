/**
 * Changing the files in a binder — not only adding them.
 *
 * Uploading a policy was the only way anything ever reached a binder, so every
 * other act a person needs on a filing system was out of reach: replacing a
 * document's contents, renaming one, filing it somewhere else, making a folder,
 * renaming a folder. Each of those is a commit; the reason none of them existed
 * is that the upload path can only *create*.
 *
 * This is the one place that knows how to propose any of them. It is deliberately
 * a general shape — a list of operations, one commit, one change request —
 * because the alternative is five endpoints that each rebuild the same branch,
 * commit and pull request and drift apart at the edges.
 *
 * **One commit, not one per file.** Gitea's `POST /repos/{owner}/{repo}/contents`
 * applies a whole list of operations atomically, so renaming a folder of twelve
 * policies is one commit a reviewer reads as one act, rather than twelve that
 * can half-apply. It also has a native `rename`, which preserves the blob
 * instead of writing a delete and an add that look like new content in a diff.
 *
 * **It proposes; it does not change anything.** `main` is protected, so the work
 * lands on a branch and opens a change request — the same path a policy takes,
 * because a binder's shape is part of its record and ADR 0004's claim is that
 * nothing reaches the record without approval.
 *
 * **A change request holds as many of these as somebody wants to put in it.**
 * Every act used to open one of its own, so revising three cross-referencing
 * policies produced three change requests that had to be approved separately
 * and could be published apart — which is precisely the thing ADR 0004 §4 says
 * the change is the unit of approval to prevent. {@link addToBinderChange}
 * commits onto a change that is already open instead of starting another.
 */

import { unwrap, type GiteaClient } from "./client";
import { createPullRequest, getPullRequestHeadBranch } from "./pullRequests";
import { createUploadBranch } from "./uploads";

/** One thing to do to one path, in the caller's language rather than Gitea's. */
export type BinderFileOperation =
  /** Write these bytes here, whether or not something is already there. */
  | { kind: "write"; path: string; base64Content: string }
  /**
   * Move a file, keeping its blob.
   *
   * Gitea's own `rename`, rather than a delete and a create: the blob is
   * preserved, so a reviewer sees a move instead of a file's entire contents
   * arriving as new. That matters most for the case this exists for — renaming
   * a policy, where the bytes did not change at all.
   */
  | { kind: "move"; from: string; to: string }
  | { kind: "remove"; path: string };

/** Gitea's wire shape for one operation. */
interface ChangeFileOperation {
  operation: "create" | "update" | "upload" | "rename" | "delete";
  path: string;
  from_path?: string;
  content?: string;
}

function toGiteaOperation(operation: BinderFileOperation): ChangeFileOperation {
  switch (operation.kind) {
    case "write":
      // `upload` rather than `create` or `update`: it is the one that works
      // whether or not the path is already taken, which is what a caller
      // replacing a document's contents actually means.
      return {
        operation: "upload",
        path: operation.path,
        content: operation.base64Content,
      };
    case "move":
      return {
        operation: "rename",
        path: operation.to,
        from_path: operation.from,
      };
    case "remove":
      return { operation: "delete", path: operation.path };
  }
}

export interface ProposedBinderFileChange {
  changeNumber: number;
  branch: string;
}

/**
 * Write a list of operations onto a branch, as one commit.
 *
 * Shared by all three of "open a change for this", "put this in the change I
 * already have", and "put this in the draft I am working in" — which differ in
 * everything around the commit and in nothing about it.
 *
 * Exported because a draft is addressed by its branch and has no change
 * request to look one up from. That is the whole difference between a draft
 * and a change: where the work goes is the same commit either way.
 */
export async function commitBinderFiles(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
  operations: readonly BinderFileOperation[];
  message: string;
}): Promise<void> {
  const { client, org, workspace, branch, operations, message } = params;

  if (operations.length === 0) {
    // A change that changes nothing would merge cleanly and publish nothing,
    // leaving somebody waiting on a version that never arrives. Refusing here
    // is the cheapest place to notice.
    throw new Error("A change has to do something to at least one file.");
  }

  await unwrap(
    client.POST("/repos/{owner}/{repo}/contents", {
      params: { path: { owner: org, repo: workspace } },
      body: {
        branch,
        message,
        files: operations.map(toGiteaOperation),
      },
    }),
  );
}

/**
 * Put these operations into a change request that is already open.
 *
 * The second half of "a change request is the unit of work": the first act
 * opens one, and every act after it can join that one rather than starting
 * another. Three policies revised together are then approved together and
 * published together, which is what ADR 0004 means by the change being the
 * unit of approval.
 *
 * Answers with the branch it committed to, because the caller has to be able
 * to say where the file went.
 */
export async function addToBinderChange(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  changeNumber: number;
  operations: readonly BinderFileOperation[];
  message: string;
}): Promise<{ changeNumber: number; branch: string }> {
  const { client, org, workspace, changeNumber, operations, message } = params;

  const branch = await getPullRequestHeadBranch({
    client,
    owner: org,
    repo: workspace,
    pullNumber: changeNumber,
  });

  if (branch === "") {
    throw new Error(
      `Change ${changeNumber} has no branch to add to, so there is nowhere to put this.`,
    );
  }

  await commitBinderFiles({
    client,
    org,
    workspace,
    branch,
    operations,
    message,
  });

  return { changeNumber, branch };
}

/**
 * Put a list of operations on a branch and open a change request for them.
 *
 * The branch name is the caller's, because it is read back: a binder works out
 * which document an open change is about from `upload/<slugPath>/…`, so a
 * change about one document has to be named for it or the binder will show an
 * open-change count against the wrong policy — or against a policy that does
 * not exist.
 */
export async function proposeBinderFileChange(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
  operations: readonly BinderFileOperation[];
  /** The commit message. One commit, so one message. */
  message: string;
  /** The change's title, in the customer's language rather than git's. */
  title: string;
  /** The change's body. The first line is the title the app shows. */
  body: string;
}): Promise<ProposedBinderFileChange> {
  const { client, org, workspace, branch, operations, message, title, body } =
    params;

  await createUploadBranch({
    client,
    owner: org,
    repo: workspace,
    branchName: branch,
    from: "main",
  });

  await commitBinderFiles({
    client,
    org,
    workspace,
    branch,
    operations,
    message,
  });

  const change = await createPullRequest({
    client,
    owner: org,
    repo: workspace,
    head: branch,
    base: "main",
    title,
    body,
  });

  if (typeof change.number !== "number") {
    // Gitea opened it and did not say which one, which leaves the caller
    // unable to send anybody to the change they just made.
    throw new Error(
      "Gitea opened the change but did not return its number, so there is nowhere to send you.",
    );
  }

  return { changeNumber: change.number, branch };
}

/**
 * How long one commit may keep taking saves, from the first of them. Past
 * this, the next save starts a commit of its own, so a draft written over an
 * afternoon keeps a checkpoint an hour.
 */
export const SAVE_FOLD_WINDOW_MS = 60 * 60 * 1000;

/** What a save may fold into: the draft's newest commit, and its parent. */
export interface FoldableSave {
  sha: string;
  parent: string;
  /**
   * When the first save it holds was made: its author date, which every fold
   * carries forward. The committer date is the latest save's.
   */
  startedAt: string;
}

/**
 * The draft's last commit, when the next save may take its place.
 *
 * **Only a save of the same document by the same person, made in the last
 * hour, on a draft nobody has been shown.** The editor saves on its own as a
 * person writes, and a commit per pause would bury the acts that mean
 * something — "New folder Night shift", "Rename Hand Hygiene" — under three
 * hundred "Edit Hand Hygiene". So consecutive saves of one document become
 * one act, the way a word processor's file is one file however often it is
 * saved.
 *
 * Every condition is read from the commit itself, never assumed:
 *
 * - **It is the draft's own**, not `main`'s. `not=main` answers only commits
 *   the draft has and the record does not; a draft with none of its own has
 *   nothing to fold into, and a commit on `main` is never rewritten.
 * - **One parent.** A merge — bringing the draft up to date — is a point the
 *   draft's history has to keep.
 * - **The same act**: the subject this save would write, the same file and
 *   nothing else, by the same person (the `Bindersnap-Uploaded-By` trailer,
 *   which the server writes from the session, never the browser).
 * - **Recent**: begun within {@link SAVE_FOLD_WINDOW_MS}.
 */
export async function findFoldableSave(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
  /** The first line the new save's commit will carry: "Edit Hand Hygiene". */
  subject: string;
  /** The one file the save writes. */
  path: string;
  username: string;
  now?: Date;
}): Promise<FoldableSave | null> {
  const { client, org, workspace, branch, subject, path, username } = params;
  const now = params.now ?? new Date();

  const rows = (await unwrap(
    client.GET("/repos/{owner}/{repo}/commits", {
      params: {
        path: { owner: org, repo: workspace },
        query: {
          sha: branch,
          not: "main",
          stat: false,
          verification: false,
          files: true,
          page: 1,
          limit: 1,
        },
      },
    }),
  ).catch(() => [])) as FoldCandidate[];

  const tip = rows[0];
  if (!tip?.sha) return null;
  const parents = tip.parents ?? [];
  if (parents.length !== 1 || !parents[0]?.sha) return null;

  const message = tip.commit?.message ?? "";
  if ((message.split("\n")[0] ?? "").trim() !== subject) return null;
  const trailers = message.split("\n").map((line) => line.trim());
  if (!trailers.includes(`Bindersnap-Uploaded-By: ${username}`)) return null;
  if (!trailers.includes(`Bindersnap-Canonical-File: ${path}`)) return null;

  const files = (tip.files ?? []).map((file) => file.filename ?? "");
  if (files.length !== 1 || files[0] !== path) return null;

  // From the first save the commit holds, not the last: a person typing all
  // afternoon would otherwise fold every save into one commit forever.
  const startedAt = tip.commit?.author?.date ?? "";
  const at = Date.parse(startedAt);
  if (!Number.isFinite(at) || now.getTime() - at > SAVE_FOLD_WINDOW_MS) {
    return null;
  }

  return { sha: tip.sha, parent: parents[0].sha, startedAt };
}

interface FoldCandidate {
  sha?: string;
  parents?: { sha?: string }[];
  files?: { filename?: string }[];
  commit?: {
    message?: string;
    author?: { date?: string };
    committer?: { date?: string };
  };
}

/**
 * Save into a draft, folded into the last save when it may be.
 *
 * Gitea cannot amend a commit, so the fold is three moves it can make: a
 * scratch branch at the last save's parent, this save committed there, and
 * the draft moved onto that commit — **only if the draft is still where it
 * was read** (`old_commit_id`). A save from another tab in between makes the
 * move fail, and this save is then committed on top as an ordinary one, so
 * nothing anybody wrote is lost to the fold. The scratch branch is deleted
 * whatever happens; it is never under `draft/`, so no list of drafts sees it.
 *
 * Answers whether the save folded, for the log.
 */
export async function commitDraftSave(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
  operations: readonly BinderFileOperation[];
  message: string;
  username: string;
  now?: Date;
}): Promise<{ folded: boolean }> {
  const { client, org, workspace, branch, operations, message, username } =
    params;
  const write = operations.length === 1 ? operations[0] : undefined;
  const previous =
    write?.kind === "write"
      ? await findFoldableSave({
          client,
          org,
          workspace,
          branch,
          subject: (message.split("\n")[0] ?? "").trim(),
          path: write.path,
          username,
          now: params.now,
        })
      : null;

  if (!previous) {
    await commitBinderFiles({
      client,
      org,
      workspace,
      branch,
      operations,
      message,
    });
    return { folded: false };
  }

  const scratch = `fold/${username}/${crypto.randomUUID()}`;
  try {
    await unwrap(
      client.POST("/repos/{owner}/{repo}/branches", {
        params: { path: { owner: org, repo: workspace } },
        body: { new_branch_name: scratch, old_ref_name: previous.parent },
      }),
    );
    const written = await unwrap(
      client.POST("/repos/{owner}/{repo}/contents", {
        params: { path: { owner: org, repo: workspace } },
        body: {
          branch: scratch,
          message,
          files: operations.map(toGiteaOperation),
          // The folded commit is dated from the first save it holds, so the
          // hour is counted from there.
          dates: {
            author: previous.startedAt,
            committer: (params.now ?? new Date()).toISOString(),
          },
        },
      }),
    );
    const sha = written.commit?.sha;
    const moved = sha
      ? await client.PUT("/repos/{owner}/{repo}/branches/{branch}", {
          params: { path: { owner: org, repo: workspace, branch } },
          body: {
            new_commit_id: sha,
            old_commit_id: previous.sha,
            force: true,
          },
        })
      : null;
    if (moved?.response.ok) return { folded: true };
  } catch {
    // Folding is a tidiness, never a reason a save fails: the ordinary
    // commit below still lands the words.
  } finally {
    await client
      .DELETE("/repos/{owner}/{repo}/branches/{branch}", {
        params: { path: { owner: org, repo: workspace, branch: scratch } },
      })
      .catch(() => undefined);
  }

  await commitBinderFiles({
    client,
    org,
    workspace,
    branch,
    operations,
    message,
  });
  return { folded: false };
}
