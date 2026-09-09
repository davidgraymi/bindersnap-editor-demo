/**
 * Reading and changing a binder's per-folder sign-off rules.
 *
 * The rules live in `.gitea/CODEOWNERS` on `main`, which is the source of
 * truth — there is no `folder_approvers` table, because a table would shadow a
 * git object Gitea enforces at merge time. `packages/utils/codeowners.ts` holds
 * the format and the validation; this module is the two things that need Gitea:
 * reading the committed file, and proposing a new one.
 *
 * **Changing the rules is an approved change, and that is the point.** `main`
 * is protected, so a new file cannot simply be written — and it should not be.
 * A product whose claim is that nothing reaches the record without approval
 * should not exempt the rules that decide who approves. So this opens a pull
 * request and returns its number, rather than reporting a success that has not
 * happened yet.
 *
 * Which is also why Gitea reads CODEOWNERS from the **base** branch: a change
 * to the rules is governed by the rules already in force, so the existing
 * approvers of `main` are the ones who sign off on changing them. That is the
 * right authority, and it falls out for free.
 */

import {
  CODEOWNERS_PATH,
  parseCodeowners,
  renderCodeowners,
  type ParsedCodeowners,
  type SignOffRule,
} from "../../../packages/utils/codeowners";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";
import { createPullRequest } from "./pullRequests";
import { commitBinaryFile, createUploadBranch } from "./uploads";

/**
 * The committed rules, or `null` when the binder has no sign-off file at all.
 *
 * `null` and "a file with no rules in it" are different answers and the screen
 * says different things about them: one is a binder nobody has set rules on,
 * the other is a binder somebody set rules on and then cleared.
 */
export async function readSignOffFile(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  ref?: string;
}): Promise<{ content: string; sha: string } | null> {
  const { client, org, workspace, ref = "main" } = params;

  try {
    const file = await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner: org, repo: workspace, filepath: CODEOWNERS_PATH },
          query: { ref },
        },
      }),
    );

    if (!file || Array.isArray(file) || typeof file.content !== "string") {
      return null;
    }

    return {
      content: Buffer.from(file.content, "base64").toString("utf8"),
      sha: file.sha ?? "",
    };
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) return null;
    throw err;
  }
}

/** The rules as Gitea will read them, plus any line it would silently drop. */
export async function readSignOffRules(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
}): Promise<ParsedCodeowners & { exists: boolean }> {
  const file = await readSignOffFile(params);
  if (!file) return { exists: false, rules: [], unreadable: [] };

  return { exists: true, ...parseCodeowners(params.org, file.content) };
}

/**
 * The branch a sign-off change lives on.
 *
 * Deliberately **not** under `upload/`, which carries a document's slug path
 * and is what `documentSlugPathFromUploadBranch` reads to work out which
 * document a change is about. A rules change is about no document, and putting
 * it under that prefix would make the binder list a policy that does not exist
 * — the exact defect the seed hit once already.
 */
export function signOffBranchName(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `sign-off/${stamp}`;
}

export interface ProposedSignOffChange {
  changeNumber: number;
  branch: string;
}

/**
 * Write the regenerated file onto a branch and open a change for it.
 *
 * Returns the change number rather than a success, because **it has not taken
 * effect**. Something has to be approved first, and a caller that cannot ignore
 * the number is a caller that cannot report otherwise.
 *
 * The title is in the customer's language rather than git's: this shows up in
 * the binder's change list beside "Infection Control Policy", and "Update
 * .gitea/CODEOWNERS" would read as machine noise in a list of policy revisions.
 */
export async function proposeSignOffRules(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  rules: readonly SignOffRule[];
  /** Who is proposing it, for the change's body. */
  author: string;
  now?: Date;
}): Promise<ProposedSignOffChange> {
  const { client, org, workspace, rules, author, now = new Date() } = params;

  const branch = signOffBranchName(now);
  const content = renderCodeowners(org, rules);

  await createUploadBranch({
    client,
    owner: org,
    repo: workspace,
    branchName: branch,
    from: "main",
  });

  await commitBinaryFile({
    client,
    owner: org,
    repo: workspace,
    branch,
    filePath: CODEOWNERS_PATH,
    base64Content: Buffer.from(content, "utf8").toString("base64"),
    message: "Change who signs off on each folder",
    // The file may or may not exist yet; `commitBinaryFile` looks before it
    // writes, so this is the one that works either way.
    isNewFile: false,
  });

  const change = await createPullRequest({
    client,
    owner: org,
    repo: workspace,
    head: branch,
    base: "main",
    title: "Change who signs off on each folder",
    // **The first line is the title the app shows**, and the rest is the
    // description under it — `parseChangeTitle` takes the body's first line.
    // So the human name for the change leads, and the explanation follows it
    // rather than becoming the heading.
    body: [
      "Change who signs off on each folder",
      "",
      `${author} proposed this. These rules decide who has to approve a change`,
      "to each folder. They take effect only once this change is published,",
      "and until then the rules already in force are the ones being applied —",
      "including to this change.",
      "",
      describeRules(org, rules),
    ].join("\n"),
  });

  if (typeof change.number !== "number") {
    // Gitea opened it and did not say which one, which leaves the caller
    // unable to send anybody to the change they just made. Better to fail
    // loudly here than to report a success with nowhere to go.
    throw new Error(
      "Gitea opened the sign-off change but did not return its number.",
    );
  }

  return { changeNumber: change.number, branch };
}

/**
 * The proposed rules, said in the change's body.
 *
 * A reviewer of this change is being asked to agree to a permission decision,
 * and the diff of a generated regex file is a poor way to see one. Saying it in
 * words means the question can be answered without reading the artefact.
 */
function describeRules(org: string, rules: readonly SignOffRule[]): string {
  if (rules.length === 0) {
    return "No folder would require its own sign-off. Every change would need only the binder's usual approvals.";
  }

  const lines = rules.map((rule) => {
    const owners = [
      ...rule.teams.map((team) => `${org}/${team}`),
      ...rule.users,
    ].join(", ");
    const where =
      rule.folder === "" ? "Everything in this binder" : rule.folder;
    return `- ${where} — signed off by ${owners}`;
  });

  return ["Proposed rules:", "", ...lines].join("\n");
}
