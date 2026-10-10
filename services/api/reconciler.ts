/**
 * What Gitea says happened that should not have: a reconciler that reads and
 * reports.
 *
 * The job table (`jobs/`) makes a publish or a new binder finish once it has
 * started. It cannot speak for what happened before it existed, or for
 * anything done to a binder outside the BFF. This walks every binder and asks
 * Gitea two questions whose wrong answers are compliance damage:
 *
 * - **Is `main` protected?** A binder whose protection never got written lets
 *   anybody with write access push to the record unreviewed.
 * - **Did every published change write its versions?** A change merged with no
 *   version tag on its merge commit is a gap in the evidence.
 *
 * It **repairs nothing**. Writing a tag or a protection rule takes write access
 * to the binder, which the service token deliberately does not have; a person
 * fixes these — pressing Publish again on the change resumes it — and this is
 * how they find out. Findings go to the log, where the CloudWatch alarm on
 * `/bindersnap/api` can see them, and to an admin diagnostics endpoint.
 *
 * No state of its own: everything is read from Gitea every pass (ADR 0004).
 */

import type { GiteaClient } from "./gitea-client/client";
import { readAllPages, unwrap } from "./gitea-client/client";
import { getRepoBranchProtection } from "./gitea-client/repos";
import { listAllTags } from "./gitea-client/workspaceDocuments";
import { listOrganizationWorkspaces } from "./gitea-client/workspaces";
import {
  documentUidFromArchivedTag,
  documentUidFromVersionTag,
} from "../../packages/utils/documentPath";

export type ReconcilerFinding =
  | { kind: "unprotected-main"; org: string; binder: string }
  | {
      kind: "merged-without-versions";
      org: string;
      binder: string;
      changeNumber: number;
      mergeCommitSha: string;
      branch: string;
    };

export interface ReconcilerReport {
  checkedAt: string;
  binders: number;
  findings: ReconcilerFinding[];
  /** Binders that could not be read this pass, and why. */
  errors: Array<{ org: string; binder: string; error: string }>;
}

interface ClosedPull {
  number?: number;
  merged?: boolean;
  merge_commit_sha?: string | null;
  head?: { ref?: string };
}

/**
 * Branches whose changes legitimately write no version: the sign-off rules
 * and the binder's shape. Publish refuses to version nothing for anything
 * else (`handlePublishWorkspaceChange`), which is what makes a merged change
 * from any other branch with no tag on its merge commit a gap.
 *
 * A draft may version nothing too — it can hold only a folder — so a draft's
 * change is reported only if it touched a document; that is decided by the
 * caller's `touchedDocuments`, read only for the few candidates.
 */
function versionsNothing(branch: string): boolean {
  return branch.startsWith("sign-off/") || branch.startsWith("shape/");
}

/** The merged changes in one binder with no version or archive tag on their merge. */
export function findUnversionedMerges(params: {
  org: string;
  binder: string;
  closed: readonly ClosedPull[];
  tagCommits: ReadonlySet<string>;
}): Extract<ReconcilerFinding, { kind: "merged-without-versions" }>[] {
  const { org, binder, closed, tagCommits } = params;
  return closed.flatMap((pull) => {
    const sha = pull.merge_commit_sha ?? "";
    const branch = pull.head?.ref ?? "";
    if (!pull.merged || !sha || typeof pull.number !== "number") return [];
    if (versionsNothing(branch) || tagCommits.has(sha)) return [];
    return [
      {
        kind: "merged-without-versions" as const,
        org,
        binder,
        changeNumber: pull.number,
        mergeCommitSha: sha,
        branch,
      },
    ];
  });
}

export async function reconcileBinders(params: {
  client: GiteaClient;
  organizations: readonly string[];
  /**
   * Whether a merged change touched a document. Asked only of candidates — a
   * merged change with no tag on its merge — so it costs a call per gap rather
   * than per change.
   */
  touchedDocuments: (params: {
    org: string;
    binder: string;
    changeNumber: number;
  }) => Promise<boolean>;
  now?: Date;
}): Promise<ReconcilerReport> {
  const { client, organizations, touchedDocuments } = params;
  const report: ReconcilerReport = {
    checkedAt: (params.now ?? new Date()).toISOString(),
    binders: 0,
    findings: [],
    errors: [],
  };

  for (const org of organizations) {
    const binders = await listOrganizationWorkspaces({ client, org }).catch(
      (err: unknown) => {
        report.errors.push({
          org,
          binder: "*",
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      },
    );

    for (const binder of binders) {
      report.binders += 1;
      try {
        const [protection, tags, closed] = await Promise.all([
          getRepoBranchProtection(client, org, binder.name, "main"),
          listAllTags({ client, owner: org, repo: binder.name }),
          readAllPages(
            (query) =>
              unwrap(
                client.GET("/repos/{owner}/{repo}/pulls", {
                  params: {
                    path: { owner: org, repo: binder.name },
                    query: { state: "closed", ...query },
                  },
                }),
              ) as Promise<ClosedPull[]>,
            { parallel: 3 },
          ),
        ]);

        if (!protection) {
          report.findings.push({
            kind: "unprotected-main",
            org,
            binder: binder.name,
          });
        }

        const tagCommits = new Set(
          tags.flatMap((tag) => {
            const name = tag.name ?? "";
            const ours =
              documentUidFromVersionTag(name) !== null ||
              documentUidFromArchivedTag(name) !== null;
            return ours && tag.commit?.sha ? [tag.commit.sha] : [];
          }),
        );

        for (const gap of findUnversionedMerges({
          org,
          binder: binder.name,
          closed,
          tagCommits,
        })) {
          if (
            await touchedDocuments({
              org,
              binder: binder.name,
              changeNumber: gap.changeNumber,
            }).catch(() => true)
          ) {
            report.findings.push(gap);
          }
        }
      } catch (err) {
        report.errors.push({
          org,
          binder: binder.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return report;
}
