#!/usr/bin/env bun

import {
  buildDocumentVersionTag,
  slugifyDocumentName,
} from "../packages/utils/documentPath";
import type { GiteaClient } from "../services/api/gitea-client/client";
import { GiteaApiError, unwrap } from "../services/api/gitea-client/client";
import {
  createWorkspaceTeams,
  grantTeamOnRepo,
  WORKSPACE_ROLES,
} from "../services/api/gitea-client/orgs";
import {
  bootstrapEmptyMainBranch,
  getRepoBranchProtection,
} from "../services/api/gitea-client/repos";
import {
  createWorkspaceRepo,
  protectWorkspaceMain,
} from "../services/api/gitea-client/workspaces";
import { createPrivilegedGiteaClient } from "../services/api/privileged-client";
import { resolveOrganizationForUser } from "../services/api/session-organization";

/**
 * ADR 0004, migration step 3: replay user-owned document repositories into a
 * binder.
 *
 * "Replay, not transfer." `POST /repos/{owner}/{repo}/transfer` moves a
 * repository whole, which is the wrong shape now — a document is a file inside
 * a workspace, not a repository. So each published version is re-committed at
 * the document's path in the target binder, in order, and re-tagged under the
 * document's own namespace.
 *
 * The ADR is emphatic that this is where the evidence is at risk, so the rules
 * here are deliberately conservative:
 *
 *   - **Nothing is deleted, ever.** Not a source repository, not a tag, not a
 *     commit. Archiving the sources is a separate, later, deliberate act, and
 *     this script does not do it.
 *   - **Every published version is preserved**, with the original author and
 *     the original date, so `git log` still answers "who wrote this, and when".
 *   - **Version tags are re-namespaced**, `doc/v0002` in a repository called
 *     `infection-control-policy` becoming `infection-control-policy/v2` in the
 *     binder — because a binder's tags are repository-global and several
 *     documents now share them.
 *   - **Approvals that cannot be carried across are written down.** A review
 *     belongs to a pull request in the source repository and cannot be
 *     re-attached to a commit elsewhere, so each replayed commit's message
 *     records who approved that version and when. The ADR asks for exactly
 *     this rather than dropping them.
 *   - **`--dry` writes nothing** and prints the whole plan.
 *   - **Re-running is safe, in both of the two ways it can happen.** After an
 *     *interrupted* run the binder exists and is unprotected — protection is
 *     applied last — so a re-run resumes it, skipping versions already
 *     replayed. After a *completed* run the binder is protected, and a re-run
 *     refuses: that binder is a live record now, and this script has no
 *     business writing to it.
 *
 * What it will not do is guess. A document whose target binder does not exist,
 * or whose slug would collide with a different document already in the binder,
 * is reported and left alone.
 */

export interface BackfillOptions {
  dryRun: boolean;
  /** Only this user's repositories. Omit to walk every user. */
  username?: string;
  /** The binder to replay into. Created beforehand, never by this script. */
  workspace: string;
}

/** One published version of one source document. */
export interface SourceVersion {
  version: number;
  tag: string;
  /** The commit the tag points at, in the source repository. */
  commitSha: string;
  /** Original author, preserved so `git log` still answers truthfully. */
  authorName: string;
  authorEmail: string;
  /** ISO 8601, from the original commit. */
  authoredAt: string;
  /** `document.pdf` — where the file sits in the source repository. */
  sourcePath: string;
  /** Who approved this version, from the pull request that published it. */
  approvals: VersionApproval[];
}

export interface VersionApproval {
  reviewer: string;
  submittedAt: string;
}

export interface DocumentPlan {
  sourceOwner: string;
  sourceRepo: string;
  /** `infection-control-policy` — the document's identity in the binder. */
  slugPath: string;
  /** `infection-control-policy.pdf` — where it lands. */
  targetPath: string;
  versions: SourceVersion[];
  /** Versions already in the binder, skipped on a re-run. */
  alreadyPresent: number[];
}

export interface BackfillReport {
  organization: string;
  workspace: string;
  planned: DocumentPlan[];
  /** Repositories this script refused to guess at, and why. */
  skipped: Array<{ repo: string; reason: string }>;
}

/** `doc/v0002` → 2. Anything else is not a version this app published. */
export function versionFromLegacyTag(tagName: string): number | null {
  const match = /^doc\/v(\d+)$/.exec(tagName);
  if (!match) return null;

  const version = Number(match[1]);
  return Number.isInteger(version) && version > 0 ? version : null;
}

/**
 * The document's identity in the binder, from the repository that held it.
 *
 * The repository name *was* the document's name, so it is what a person will
 * recognise. It is slugified again because a repository name may contain
 * characters a path segment should not.
 */
export function slugPathForSourceRepo(repoName: string): string {
  return slugifyDocumentName(repoName);
}

/** `document.pdf` in the source becomes `infection-control-policy.pdf`. */
export function targetPathFor(slugPath: string, sourcePath: string): string {
  const lastDot = sourcePath.lastIndexOf(".");
  const extension = lastDot <= 0 ? "" : sourcePath.slice(lastDot);
  return `${slugPath}${extension}`;
}

/**
 * What the replayed commit says.
 *
 * The provenance is the point: a surveyor asking where this version came from
 * gets the answer from the record itself rather than from a migration runbook
 * nobody kept. Approvals are written here because a review cannot follow a
 * commit into another repository, and losing them silently is the one outcome
 * the ADR rules out.
 */
export function buildReplayCommitMessage(
  plan: DocumentPlan,
  version: SourceVersion,
): string {
  const lines = [
    `Publish v${version.version}: ${plan.slugPath}`,
    "",
    `Replayed from ${plan.sourceOwner}/${plan.sourceRepo} (ADR 0004 migration).`,
    `Source tag: ${version.tag}`,
    `Source commit: ${version.commitSha}`,
    `Originally authored by ${version.authorName} <${version.authorEmail}> on ${version.authoredAt}`,
  ];

  if (version.approvals.length > 0) {
    lines.push("");
    lines.push("Approved in the source repository by:");
    for (const approval of version.approvals) {
      lines.push(`  ${approval.reviewer} on ${approval.submittedAt}`);
    }
  } else {
    lines.push("");
    // Said plainly rather than left blank: "no approval recorded" and "we lost
    // the approval" look identical in a silent migration, and they are not the
    // same fact.
    lines.push("No approval was recorded on the source pull request.");
  }

  return lines.join("\n");
}

interface GiteaTag {
  name?: string;
  commit?: { sha?: string };
}

interface GiteaCommit {
  sha?: string;
  commit?: {
    author?: { name?: string; email?: string; date?: string };
    message?: string;
  };
}

/** Every published version of one source repository, oldest first. */
export async function readSourceVersions(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
}): Promise<SourceVersion[]> {
  const { client, owner, repo } = params;

  const tags = (await unwrap(
    client.GET("/repos/{owner}/{repo}/tags", {
      params: { path: { owner, repo } },
    }),
  )) as GiteaTag[];

  const versions: SourceVersion[] = [];

  for (const tag of tags ?? []) {
    const name = tag.name ?? "";
    const version = versionFromLegacyTag(name);
    if (version === null) continue;

    const commitSha = tag.commit?.sha ?? "";
    if (commitSha === "") continue;

    const commit = (await unwrap(
      client.GET("/repos/{owner}/{repo}/git/commits/{sha}", {
        params: { path: { owner, repo, sha: commitSha } },
      }),
    )) as GiteaCommit;

    const sourcePath = await findCanonicalPath({
      client,
      owner,
      repo,
      ref: commitSha,
    });
    if (sourcePath === null) continue;

    versions.push({
      version,
      tag: name,
      commitSha,
      authorName: commit.commit?.author?.name ?? "Unknown",
      authorEmail: commit.commit?.author?.email ?? "unknown@bindersnap.local",
      authoredAt: commit.commit?.author?.date ?? new Date(0).toISOString(),
      sourcePath,
      approvals: await readApprovalsForCommit({
        client,
        owner,
        repo,
        commitSha,
      }),
    });
  }

  // Oldest first: the binder's history should read in the order it happened.
  return versions.sort((a, b) => a.version - b.version);
}

interface TreeEntry {
  path?: string;
  type?: string;
}

/** The `document.<ext>` the old model wrote, whatever its extension is. */
async function findCanonicalPath(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
  ref: string;
}): Promise<string | null> {
  const { client, owner, repo, ref } = params;

  try {
    const tree = (await unwrap(
      client.GET("/repos/{owner}/{repo}/git/trees/{sha}", {
        params: { path: { owner, repo, sha: ref } },
      }),
    )) as { tree?: TreeEntry[] };

    const entry = (tree.tree ?? []).find(
      (item) =>
        item.type === "blob" && (item.path ?? "").startsWith("document."),
    );

    return entry?.path ?? null;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) return null;
    throw err;
  }
}

interface GiteaPull {
  number?: number;
  merged?: boolean;
  merge_commit_sha?: string;
}

interface GiteaReview {
  state?: string;
  user?: { login?: string };
  submitted_at?: string;
  dismissed?: boolean;
  stale?: boolean;
}

/**
 * Who approved the change that produced this commit.
 *
 * A review lives on a pull request in the source repository and cannot be
 * moved, so this reads it in order to write it into the replayed commit's
 * message. A commit with no pull request behind it is not an error — early
 * documents predate the review flow — it simply has nothing to record.
 */
export async function readApprovalsForCommit(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
  commitSha: string;
}): Promise<VersionApproval[]> {
  const { client, owner, repo, commitSha } = params;

  try {
    const pulls = (await unwrap(
      client.GET("/repos/{owner}/{repo}/pulls", {
        params: { path: { owner, repo }, query: { state: "closed" } },
      }),
    )) as GiteaPull[];

    const merged = (pulls ?? []).find(
      (pull) => pull.merged === true && pull.merge_commit_sha === commitSha,
    );
    if (!merged?.number) return [];

    const reviews = (await unwrap(
      client.GET("/repos/{owner}/{repo}/pulls/{index}/reviews", {
        params: { path: { owner, repo, index: merged.number } },
      }),
    )) as GiteaReview[];

    return (reviews ?? [])
      .filter(
        (review) =>
          review.state === "APPROVED" && !review.dismissed && !review.stale,
      )
      .map((review) => ({
        reviewer: review.user?.login ?? "unknown",
        submittedAt: review.submitted_at ?? "",
      }));
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) return [];
    throw err;
  }
}

interface RepoSummary {
  name?: string;
  owner?: { login?: string };
  archived?: boolean;
}

/**
 * The document repositories one person holds.
 *
 * A repository with no `doc/vN` tag has published nothing, so there is no
 * evidence in it to preserve and nothing for this script to replay. It is
 * reported as skipped rather than silently passed over, because "empty" and
 * "we did not look" are different facts.
 */
export async function listSourceRepos(params: {
  client: GiteaClient;
  username: string;
}): Promise<RepoSummary[]> {
  const { client, username } = params;

  const repos = (await unwrap(
    client.GET("/users/{username}/repos", {
      params: { path: { username }, query: { limit: 200 } },
    }),
  )) as RepoSummary[];

  return (repos ?? []).filter((repo) => (repo.name ?? "") !== "");
}

/**
 * Read everything, decide nothing, write nothing.
 *
 * The plan is the artefact an operator reads before any of this is allowed to
 * touch a customer's record, so it is built in full — including the approvals
 * — before a single commit is made.
 */
export async function planBackfill(params: {
  client: GiteaClient;
  username: string;
  organization: string;
  workspace: string;
}): Promise<BackfillReport> {
  const { client, username, organization, workspace } = params;

  const report: BackfillReport = {
    organization,
    workspace,
    planned: [],
    skipped: [],
  };

  const existingTags = await readExistingVersionTags({
    client,
    org: organization,
    workspace,
  });

  const claimedSlugs = new Map<string, string>();

  for (const repo of await listSourceRepos({ client, username })) {
    const sourceRepo = repo.name!;
    const versions = await readSourceVersions({
      client,
      owner: username,
      repo: sourceRepo,
    });

    if (versions.length === 0) {
      report.skipped.push({
        repo: `${username}/${sourceRepo}`,
        reason: "no published version — nothing to preserve",
      });
      continue;
    }

    const slugPath = slugPathForSourceRepo(sourceRepo);
    if (slugPath === "") {
      report.skipped.push({
        repo: `${username}/${sourceRepo}`,
        reason: "name does not reduce to a usable path",
      });
      continue;
    }

    // Two repositories whose names differ only in punctuation would land on one
    // path and overwrite each other. That is a decision about what the customer
    // meant, not one to make at 3am in a migration.
    const claimedBy = claimedSlugs.get(slugPath);
    if (claimedBy) {
      report.skipped.push({
        repo: `${username}/${sourceRepo}`,
        reason: `would land on "${slugPath}", already taken by ${claimedBy}`,
      });
      continue;
    }
    claimedSlugs.set(slugPath, `${username}/${sourceRepo}`);

    report.planned.push({
      sourceOwner: username,
      sourceRepo,
      slugPath,
      targetPath: targetPathFor(slugPath, versions[0]!.sourcePath),
      versions,
      alreadyPresent: versions
        .filter((version) =>
          existingTags.has(buildDocumentVersionTag(slugPath, version.version)),
        )
        .map((version) => version.version),
    });
  }

  return report;
}

/** Version tags already in the binder, so a re-run resumes rather than repeats. */
async function readExistingVersionTags(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
}): Promise<Set<string>> {
  const { client, org, workspace } = params;

  try {
    const tags = (await unwrap(
      client.GET("/repos/{owner}/{repo}/tags", {
        params: { path: { owner: org, repo: workspace } },
      }),
    )) as GiteaTag[];

    return new Set((tags ?? []).map((tag) => tag.name ?? ""));
  } catch (err) {
    // No binder yet is the ordinary first run.
    if (err instanceof GiteaApiError && err.status === 404) return new Set();
    throw err;
  }
}

/** The file's bytes at one source tag, base64 as Gitea stores them. */
async function readBlobAtRef(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}): Promise<string> {
  const { client, owner, repo, path, ref } = params;

  const contents = (await unwrap(
    client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
      params: { path: { owner, repo, filepath: path }, query: { ref } },
    }),
  )) as { content?: string; encoding?: string };

  if (typeof contents.content !== "string") {
    throw new Error(`${owner}/${repo}:${path}@${ref} has no readable content`);
  }

  return contents.content.replace(/\s/g, "");
}

/**
 * Replay one document's versions into the binder, oldest first.
 *
 * Each version becomes a commit carrying the original author and date, and
 * then a tag under the document's own namespace. The commits go onto `main`
 * directly, which is only possible because the binder is not protected yet —
 * see `runBackfill`, which protects it once the replay is done.
 */
export async function replayDocument(params: {
  client: GiteaClient;
  organization: string;
  workspace: string;
  plan: DocumentPlan;
}): Promise<number[]> {
  const { client, organization, workspace, plan } = params;
  const replayed: number[] = [];

  for (const version of plan.versions) {
    if (plan.alreadyPresent.includes(version.version)) continue;

    const content = await readBlobAtRef({
      client,
      owner: plan.sourceOwner,
      repo: plan.sourceRepo,
      path: version.sourcePath,
      ref: version.commitSha,
    });

    const message = buildReplayCommitMessage(plan, version);
    const author = { name: version.authorName, email: version.authorEmail };
    // Preserve both dates: `git log` and any audit export read the author date,
    // and a committer date of "now" would be a lie about when this happened.
    const dates = { author: version.authoredAt, committer: version.authoredAt };

    const existing = await findExistingFileSha({
      client,
      org: organization,
      workspace,
      path: plan.targetPath,
    });

    const commit = (await unwrap(
      existing === null
        ? client.POST("/repos/{owner}/{repo}/contents/{filepath}", {
            params: {
              path: {
                owner: organization,
                repo: workspace,
                filepath: plan.targetPath,
              },
            },
            body: { content, message, branch: "main", author, dates },
          })
        : client.PUT("/repos/{owner}/{repo}/contents/{filepath}", {
            params: {
              path: {
                owner: organization,
                repo: workspace,
                filepath: plan.targetPath,
              },
            },
            body: {
              content,
              message,
              branch: "main",
              sha: existing,
              author,
              dates,
            },
          }),
    )) as { commit?: { sha?: string } };

    const sha = commit.commit?.sha;
    if (!sha) {
      throw new Error(
        `Replaying ${plan.slugPath} v${version.version} returned no commit`,
      );
    }

    await unwrap(
      client.POST("/repos/{owner}/{repo}/tags", {
        params: { path: { owner: organization, repo: workspace } },
        body: {
          tag_name: buildDocumentVersionTag(plan.slugPath, version.version),
          target: sha,
          message: `Replayed ${version.tag} from ${plan.sourceOwner}/${plan.sourceRepo}`,
        },
      }),
    );

    replayed.push(version.version);
  }

  return replayed;
}

async function findExistingFileSha(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  path: string;
}): Promise<string | null> {
  const { client, org, workspace, path } = params;

  try {
    const contents = (await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner: org, repo: workspace, filepath: path },
          query: { ref: "main" },
        },
      }),
    )) as { sha?: string };

    return contents.sha ?? null;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) return null;
    throw err;
  }
}

export function parseArgs(argv: string[]): BackfillOptions {
  const workspaceArg = argv.find((arg) => arg.startsWith("--workspace="));
  const userArg = argv.find((arg) => arg.startsWith("--user="));

  return {
    dryRun: argv.includes("--dry"),
    username: userArg?.split("=")[1],
    workspace: workspaceArg?.split("=")[1] ?? "binder",
  };
}

export function formatReport(report: BackfillReport): string {
  const lines: string[] = [];

  lines.push(`Organization: ${report.organization}`);
  lines.push(`Binder:       ${report.workspace}`);
  lines.push("");

  for (const plan of report.planned) {
    const replaying = plan.versions.filter(
      (version) => !plan.alreadyPresent.includes(version.version),
    );

    lines.push(`${plan.sourceOwner}/${plan.sourceRepo} → ${plan.targetPath}`);
    if (replaying.length === 0) {
      lines.push("  already replayed, nothing to do");
      continue;
    }

    for (const version of replaying) {
      const approvals =
        version.approvals.length > 0
          ? version.approvals.map((a) => a.reviewer).join(", ")
          : "no approval recorded";
      lines.push(
        `  v${version.version} → ${buildDocumentVersionTag(plan.slugPath, version.version)}  (${version.authorName}, ${approvals})`,
      );
    }
  }

  if (report.skipped.length > 0) {
    lines.push("");
    lines.push("Skipped, and why — these need a decision, not a guess:");
    for (const skip of report.skipped) {
      lines.push(`  ${skip.repo}: ${skip.reason}`);
    }
  }

  return lines.join("\n");
}

/**
 * Create the binder unprotected, replay into it, and protect it last.
 *
 * `main` is protected in a finished binder — nothing reaches it except a
 * merged, approved change — which is exactly the rule a replay cannot satisfy:
 * these commits were approved years ago, in another repository, by people who
 * may have left. Rather than weakening the rule or forging approvals, the
 * binder is built before the rule is applied to it.
 *
 * The order matters if this is interrupted: an unfinished binder is
 * unprotected, which is visible and repairable by running this again. The
 * alternative — protecting first and disabling protection per commit — leaves
 * a customer's binder unprotected in a way nobody would notice.
 */
export async function runBackfill(params: {
  client: GiteaClient;
  username: string;
  organization: string;
  workspace: string;
  dryRun: boolean;
}): Promise<BackfillReport> {
  const { client, username, organization, workspace, dryRun } = params;

  const report = await planBackfill({
    client,
    username,
    organization,
    workspace,
  });

  if (dryRun) return report;

  // A binder that already exists *and* is protected is somebody's live record,
  // not this script's workspace. Replaying into it would mean either forging
  // approvals for commits made years ago in another repository, or lifting the
  // protection off a customer's binder — so it refuses and asks for a name.
  //
  // An existing *unprotected* binder is this script's own interrupted run:
  // protection is applied last, so that is the state a crash leaves behind,
  // and resuming into it is exactly right.
  const protection = await getRepoBranchProtection(
    client,
    organization,
    workspace,
    "main",
  ).catch(() => null);

  if (protection) {
    throw new Error(
      `${organization}/${workspace} already exists and its main is protected. ` +
        `Replaying into it would require weakening that rule. Choose another ` +
        `binder with --workspace=<name>.`,
    );
  }

  await createWorkspaceRepo({
    client,
    org: organization,
    name: workspace,
    description: `Replayed from ${username}'s documents (ADR 0004 migration).`,
  });
  await bootstrapEmptyMainBranch({
    client,
    owner: organization,
    repo: workspace,
  });

  for (const plan of report.planned) {
    await replayDocument({ client, organization, workspace, plan });
  }

  const teams = await createWorkspaceTeams({
    client,
    org: organization,
    workspace,
  });
  for (const role of WORKSPACE_ROLES) {
    await grantTeamOnRepo({
      client,
      teamId: teams[role].id,
      org: organization,
      repo: workspace,
    });
  }

  // Last, so the replay above was possible and the binder ends up governed.
  await protectWorkspaceMain({ client, org: organization, workspace });

  return report;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));

  if (!options.username) {
    console.error("Usage: bun scripts/backfill-workspace-documents.ts \\");
    console.error("         --user=<username> [--workspace=binder] [--dry]");
    process.exit(1);
  }

  const client = createPrivilegedGiteaClient();
  if (!client) {
    // Reading another person's private repositories needs the admin token, and
    // there is no safe half-measure: without it this would silently plan a
    // migration from the repositories it happened to be allowed to see.
    console.error(
      "No privileged Gitea client. Set the admin token before running this.",
    );
    process.exit(1);
  }

  const organization = await resolveOrganizationForUser(
    client,
    options.username,
  );

  if (!organization) {
    // The mapping this script needs is the one thing it must not invent.
    console.error(
      `${options.username} has no organization. Create one first — this script replays into a binder, it does not decide who owns it.`,
    );
    process.exit(1);
  }

  console.log(
    options.dryRun
      ? "Dry run — nothing will be written.\n"
      : "Replaying. Source repositories are never modified or deleted.\n",
  );

  const report = await runBackfill({
    client,
    username: options.username,
    organization: organization.name,
    workspace: options.workspace,
    dryRun: options.dryRun,
  }).catch((err: unknown) => {
    // An operator running a migration wants the sentence, not a stack trace.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

  console.log(formatReport(report));

  if (options.dryRun) {
    console.log(
      "\nRead the plan above, then re-run without --dry. Sources are kept;",
    );
    console.log("archiving them is a separate, later, deliberate act.");
  }
}
