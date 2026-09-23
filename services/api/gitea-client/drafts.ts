/**
 * A draft: work in progress that has not been proposed to anybody yet.
 *
 * **The gap this closes.** Every act on a binder opened a change request the
 * instant it happened — add a policy, and three people are notified that you
 * have proposed something before you have finished deciding what you are
 * proposing. There was no way to make a folder, move four policies into it,
 * rename one, and *then* say what the whole thing was for. Worse, the change
 * request's title and body were written by the server, so the person who made
 * the change did not own the sentence that explained it.
 *
 * A draft is a branch with commits and no change request. It is exactly git's
 * own answer, which is the answer ADR 0004 says to reach for: use the Gitea
 * primitive where one exists. Work accumulates on it, each act a commit, and
 * nothing about it is visible to a reviewer until its owner opens a change
 * request and writes the title themselves.
 *
 * **Several drafts per person, and the branch name says whose each is.** This
 * was one per person, on the reasoning that "resume where I was" should have a
 * single answer. The customer asked for more, and the reason is good and is
 * about the record rather than about convenience: two unrelated
 * reorganisations should not have to be proposed in one change request, and
 * approved or refused together, because the same person happened to do both.
 *
 * So the stamp in `draft/<username>/<stamp>` stops being defensive and becomes
 * load-bearing — it is what makes two of a person's drafts different branches.
 * Which draft you are in is something the caller says, not something this
 * module guesses, and a draft carries a name its author wrote so that
 * "resume the one from Tuesday" has an answer. See `draft-names.ts`.
 *
 * **A draft is not a change request and must never be read as one.** It has no
 * reviewers, no approvals, and no claim on anybody's attention. The moment it
 * acquires a change request it stops being a draft and every list here drops
 * it — which is why {@link listBinderDrafts} subtracts the open changes rather
 * than trusting the prefix alone.
 */

import { unwrap, GiteaApiError, type GiteaClient } from "./client";
import { createUploadBranch } from "./uploads";

/**
 * What every draft branch starts with.
 *
 * Deliberately its own prefix rather than `upload/` or `shape/`: those two are
 * read to work out what an open change is about, and a draft can hold any
 * mixture of acts — including none that touch a document at all.
 */
export const DRAFT_BRANCH_PREFIX = "draft/";

/** One act on a draft, as a person would describe it. */
export interface DraftAct {
  /** The commit's subject line. The planners write these in plain language. */
  summary: string;
  sha: string;
  at: string | null;
  /** Paths this commit touched, for a draft that wants to show its shape. */
  paths: string[];
}

export interface BinderDraft {
  branch: string;
  /** Whose draft it is, read from the branch name. */
  owner: string;
  /** When it was last worked on — its newest commit. */
  updatedAt: string | null;
  /** The last thing done to it, so a list of drafts reads as a list of work. */
  lastAct: string | null;
}

/**
 * The branch a person's next draft lives on.
 *
 * The username is in the name because a draft is owned, and the stamp is
 * because a proposed draft keeps its branch for as long as its change request
 * is open — so `draft/alice` alone would collide with work Alice proposed an
 * hour ago and is still waiting on.
 *
 * **To the millisecond, because the stamp is load-bearing now.** It was to the
 * second, which was enough when a person could only have one draft: the second
 * press of Edit resumed rather than forking, so two branches a second apart
 * never arose. Now that starting another is a deliberate act, two in one
 * second is a double-click — and Gitea answers the second with "the branch
 * already exists", which is a true sentence about nothing the person did.
 *
 * Fixed width, so the stamps of two drafts sort in the order they were made.
 * {@link listBinderDrafts} leans on that to break a tie between two drafts
 * with nothing committed to either.
 */
export function buildDraftBranchName(
  username: string,
  now: Date = new Date(),
): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  return `${DRAFT_BRANCH_PREFIX}${username}/${stamp}`;
}

export function isDraftBranch(branch: string): boolean {
  return draftOwner(branch) !== null;
}

/**
 * Whose draft this branch is, or null if it is not a draft branch at all.
 *
 * A username cannot contain a slash in Gitea, so the segment after the prefix
 * is the whole of it. Anything shaped differently — `draft/alice` with no
 * stamp, `feature/draft/alice/1` — is somebody else's branch and is left
 * alone rather than claimed.
 */
export function draftOwner(branch: string): string | null {
  if (!branch.startsWith(DRAFT_BRANCH_PREFIX)) return null;
  const rest = branch.slice(DRAFT_BRANCH_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 2) return null;
  const [owner, stamp] = parts;
  if (!owner || !stamp) return null;
  return owner;
}

/** Gitea's branch row, narrowed to what a draft list needs. */
interface BranchRow {
  name?: string;
  commit?: { id?: string; timestamp?: string; message?: string };
}

/** Gitea's commit row, narrowed the same way. */
interface CommitRow {
  sha?: string;
  commit?: { message?: string; committer?: { date?: string } };
  files?: Array<{ filename?: string }>;
}

/**
 * The drafts in a binder that are still drafts.
 *
 * Two reads, not one per branch: every `draft/` branch, minus every branch an
 * open change request already sits on. A draft that has been proposed is a
 * change request and belongs in the changes list, not here — showing it in
 * both would offer "propose this" against something already proposed.
 */
export async function listBinderDrafts(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  /** Narrow to one person's drafts. Omit for every draft in the binder. */
  owner?: string;
}): Promise<BinderDraft[]> {
  const { client, org, workspace, owner } = params;

  let branches: BranchRow[];
  try {
    branches = ((await unwrap(
      client.GET("/repos/{owner}/{repo}/branches", {
        params: {
          path: { owner: org, repo: workspace },
          query: { limit: 100 },
        },
      }),
    )) ?? []) as BranchRow[];
  } catch (err) {
    // A binder with no branches beyond `main` is not an error, and neither is
    // one Gitea has not finished creating.
    if (err instanceof GiteaApiError && err.status === 404) return [];
    throw err;
  }

  // The pulls endpoint straight, rather than `listPullRequests` — that one
  // reads every change's reviews as well, and this needs nothing but the list
  // of branches already spoken for. On a busy binder the difference is a
  // round trip per open change, paid to answer a question about branches.
  const open = ((await unwrap(
    client.GET("/repos/{owner}/{repo}/pulls", {
      params: {
        path: { owner: org, repo: workspace },
        query: { state: "open", limit: 100 },
      },
    }),
  )) ?? []) as Array<{ head?: { ref?: string } }>;
  const proposed = new Set(
    open.map((pull) => pull.head?.ref ?? "").filter((ref) => ref !== ""),
  );

  return branches
    .flatMap((branch) => {
      const name = branch.name ?? "";
      const branchOwner = draftOwner(name);
      if (branchOwner === null) return [];
      if (owner !== undefined && branchOwner !== owner) return [];
      if (proposed.has(name)) return [];

      return [
        {
          branch: name,
          owner: branchOwner,
          updatedAt: branch.commit?.timestamp ?? null,
          lastAct: firstLine(branch.commit?.message ?? "") || null,
        },
      ];
    })
    .sort(
      (left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
        // **Newest made wins a tie**, and ties are the ordinary case for a
        // draft nobody has committed to: a fresh branch's newest commit is
        // `main`'s, so two empty drafts report the same instant. The stamp in
        // the branch name is when each was made, fixed width, so it sorts.
        right.branch.localeCompare(left.branch),
    );
}

/**
 * The draft a person was working in most recently, if they have one.
 *
 * Newest wins, which is what "carry on where I was" means when somebody has
 * several. Pressing Edit resumes this one; starting another is a separate act
 * with a name attached, because forking work by accident is the mistake the
 * one-draft rule existed to prevent and it is still worth preventing.
 */
export async function findCurrentDraft(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  owner: string;
}): Promise<BinderDraft | null> {
  const drafts = await listBinderDrafts(params);
  return drafts[0] ?? null;
}

/**
 * Make a draft. Always a new one.
 *
 * **This used to resume the first draft it found, and no longer does.** A
 * person may have several, so "which one" is a question with more than one
 * answer and is not this function's to guess — the route above it decides
 * whether a press of Edit resumes {@link findCurrentDraft} or starts
 * something new, and says so.
 *
 * The stamp is to the second, so two drafts started in the same second by the
 * same person would collide. Gitea refuses the second branch rather than
 * silently sharing one, which is the right failure: a caller is told, and
 * pressing again a moment later works.
 */
export async function startDraft(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  username: string;
  now?: Date;
}): Promise<BinderDraft> {
  const { client, org, workspace, username, now } = params;

  const branch = buildDraftBranchName(username, now ?? new Date());
  await createUploadBranch({
    client,
    owner: org,
    repo: workspace,
    branchName: branch,
    from: "main",
  });

  return { branch, owner: username, updatedAt: null, lastAct: null };
}

/**
 * Carry on where you were, or start your first draft.
 *
 * What a press of Edit means. Idempotent, deliberately: Edit is not a
 * destructive act and the second press must put a person back in the work they
 * have rather than fork it. Starting a *second* draft is a different act, and
 * asks for a name.
 */
export async function openDraft(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  username: string;
  now?: Date;
}): Promise<BinderDraft> {
  const existing = await findCurrentDraft({
    client: params.client,
    org: params.org,
    workspace: params.workspace,
    owner: params.username,
  });
  if (existing) return existing;

  return startDraft(params);
}

/**
 * What is on a draft: every commit it has that `main` does not.
 *
 * `not=main` is the whole trick, and it is why this does not need a diff: the
 * acts are the commits, each written by the planner that made it in the
 * language the person used. A draft that made a folder and renamed two
 * policies reads back as those three sentences, which is exactly what the
 * change request's description should be prefilled with.
 *
 * Newest first, the way Gitea returns them.
 */
export async function readDraftActs(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
}): Promise<DraftAct[]> {
  const { client, org, workspace, branch } = params;

  try {
    const commits = ((await unwrap(
      client.GET("/repos/{owner}/{repo}/commits", {
        params: {
          path: { owner: org, repo: workspace },
          query: {
            sha: branch,
            not: "main",
            stat: false,
            verification: false,
            files: true,
            limit: 100,
          },
        },
      }),
    )) ?? []) as CommitRow[];

    return commits.map((commit) => ({
      summary: firstLine(commit.commit?.message ?? ""),
      sha: commit.sha ?? "",
      at: commit.commit?.committer?.date ?? null,
      paths: (commit.files ?? [])
        .map((file) => file.filename ?? "")
        .filter((path) => path !== ""),
    }));
  } catch (err) {
    // A branch that exists with nothing on it yet — made a second ago and not
    // committed to — is an empty draft, not a failure.
    if (err instanceof GiteaApiError && err.status === 404) return [];
    throw err;
  }
}

/**
 * Throw the draft away.
 *
 * Deleting the branch is the whole of it: nothing else refers to a draft, and
 * nothing on it ever reached `main`. A draft with a change request open on it
 * is refused by the caller before this is reached — deleting that branch would
 * take a change request under review with it.
 */
export async function discardDraft(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  branch: string;
}): Promise<void> {
  const { client, org, workspace, branch } = params;

  // **Not `unwrap`, and the reason is worth stating.** Gitea answers a branch
  // delete with `204 No Content`, and `unwrap` treats "no data" as a failure —
  // so the branch would be deleted and the caller told it had failed, with the
  // 204 handed on as if it were an error status. Verified against a running
  // Gitea: the delete succeeded and the API answered 204 with an empty body
  // where it meant to answer 200 with the branch it removed.
  //
  // Every other Gitea call in the product returns a body, which is why this is
  // the first place it bites. A success is any 2xx.
  const { response } = await client.DELETE(
    "/repos/{owner}/{repo}/branches/{branch}",
    { params: { path: { owner: org, repo: workspace, branch } } },
  );

  if (!response.ok) {
    throw new GiteaApiError(
      response.status,
      `Gitea refused to delete the branch "${branch}".`,
    );
  }
}

/** The subject of a commit message, which is all a list of acts shows. */
function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() ?? "";
}
