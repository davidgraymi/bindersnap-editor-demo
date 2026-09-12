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
 */

import { unwrap, type GiteaClient } from "./client";
import { createPullRequest } from "./pullRequests";
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

  if (operations.length === 0) {
    // A change that changes nothing would merge cleanly and publish nothing,
    // leaving somebody waiting on a version that never arrives. Refusing here
    // is the cheapest place to notice.
    throw new Error("A change has to do something to at least one file.");
  }

  await createUploadBranch({
    client,
    owner: org,
    repo: workspace,
    branchName: branch,
    from: "main",
  });

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
