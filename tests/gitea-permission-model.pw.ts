/**
 * ADR 0004 — "Open Before Implementation": the two Gitea claims the workspace
 * model rests on, executed against the real stack.
 *
 * 1. A reviewer team without write access can submit a review whose approval
 *    *counts* toward `required_approvals`. This is what makes "reviewers are
 *    free forever" (#369) safe to promise: it is a Gitea permission, not an
 *    app check.
 * 2. `.gitea/CODEOWNERS` paired with `block_on_official_review_requests`
 *    blocks a merge while a code owner's requested review is outstanding —
 *    that is, CODEOWNERS is enforcement, not only auto-assignment.
 *
 * Both hold, but only with `enable_approvals_whitelist: true` and the role
 * teams listed in `approvals_whitelist_teams`. Gitea's default for "who is an
 * official reviewer" is "anyone with write access on repo.code", which would
 * silently discard every free reviewer's approval. The `it does not count
 * without the whitelist` case below pins that trap in place so nobody removes
 * the whitelist as redundant.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import {
  GiteaApiError,
  type GiteaClient,
} from "../services/api/gitea-client/client";
import { createUserClient, GITEA_ADMIN_USER, GITEA_BOB_USER } from "./helpers";

// One provisioning + change cycle is a few dozen Gitea round trips. The suite
// default (10 s) is sized for UI tests, not for this.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const AUTHOR = GITEA_BOB_USER; // seeded, opens the change
const REVIEWER = "carol"; // seeded, reviews it without write access

/** Unique per run so repeated runs never collide inside one Gitea volume. */
function uniqueOrgName(): string {
  return `bs-adr4-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface Workspace {
  org: string;
  repo: string;
  adminsTeamId: number;
  authorsTeamId: number;
  reviewersTeamId: number;
}

async function post<T>(
  client: GiteaClient,
  path: string,
  body: unknown,
): Promise<T> {
  // The typed client's path union does not cover every org/team route with the
  // literal-string ergonomics this fixture wants, so provisioning goes through
  // an untyped escape hatch. Production code uses the typed wrappers.
  const untyped = client as unknown as {
    POST: (
      p: string,
      init: { body?: unknown },
    ) => Promise<{ data?: T; error?: unknown; response: Response }>;
  };
  const { data, error, response } = await untyped.POST(path, { body });
  if (error !== undefined || !response.ok) {
    throw new GiteaApiError(response.status, JSON.stringify(error ?? {}));
  }
  return data as T;
}

async function put(client: GiteaClient, path: string): Promise<void> {
  const untyped = client as unknown as {
    PUT: (
      p: string,
      init: Record<string, never>,
    ) => Promise<{ error?: unknown; response: Response }>;
  };
  const { error, response } = await untyped.PUT(path, {});
  if (error !== undefined || !response.ok) {
    throw new GiteaApiError(response.status, JSON.stringify(error ?? {}));
  }
}

async function get<T>(client: GiteaClient, path: string): Promise<T> {
  const untyped = client as unknown as {
    GET: (
      p: string,
    ) => Promise<{ data?: T; error?: unknown; response: Response }>;
  };
  const { data, error, response } = await untyped.GET(path);
  if (error !== undefined || !response.ok) {
    throw new GiteaApiError(response.status, JSON.stringify(error ?? {}));
  }
  return data as T;
}

/**
 * Wait until Gitea has finished computing the change's merge status.
 *
 * Opening a change kicks off an asynchronous conflict check, and a merge
 * attempted before it lands is refused with "Please try again later" — which
 * looks exactly like a branch-protection refusal from the outside and would
 * make every assertion below meaningless. `mergeable` here is Gitea's
 * "not checking, not conflicted, not a draft"; branch protection is decided
 * separately, at merge, which is what these tests are actually about.
 */
async function waitForMergeCheck(
  client: GiteaClient,
  workspace: Workspace,
  index: number,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pull = await get<{ mergeable?: boolean }>(
      client,
      `/repos/${workspace.org}/${workspace.repo}/pulls/${index}`,
    );
    if (pull.mergeable) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Gitea never finished the merge check for ${workspace.org}/${workspace.repo}#${index}.`,
  );
}

/**
 * Provision an organization, a workspace repository owned by it, and the three
 * role teams granted onto that repository — the shape ADR 0004 §2 describes.
 */
async function provisionWorkspace(
  admin: GiteaClient,
  options: {
    enableApprovalsWhitelist: boolean;
    codeowners?: (org: string, repo: string) => string;
  },
): Promise<Workspace> {
  const org = uniqueOrgName();
  const repo = "binder";

  await post(admin, "/orgs", { username: org, visibility: "private" });
  await post(admin, `/orgs/${org}/repos`, {
    name: repo,
    private: true,
    auto_init: true,
    default_branch: "main",
  });

  // CODEOWNERS is seeded before `main` is protected, because after protection
  // the only way anything reaches `main` is an approved change — which is the
  // point. Real provisioning has the same ordering problem and the same answer.
  if (options.codeowners !== undefined) {
    await post(admin, `/repos/${org}/${repo}/contents/.gitea/CODEOWNERS`, {
      content: Buffer.from(options.codeowners(org, repo)).toString("base64"),
      message: "Add CODEOWNERS",
    });
  }

  const admins = await post<{ id: number }>(admin, `/orgs/${org}/teams`, {
    name: `${repo}-admins`,
    permission: "admin",
  });
  const authors = await post<{ id: number }>(admin, `/orgs/${org}/teams`, {
    name: `${repo}-authors`,
    permission: "write",
    units_map: {
      "repo.code": "write",
      "repo.pulls": "write",
      "repo.issues": "write",
      "repo.releases": "write",
    },
  });
  // Read on code and read on pulls. Gitea's `/pulls` route group is guarded by
  // reqRepoReader(unit.TypeCode) + mustAllowPulls (read on repo.pulls), and the
  // review endpoints add only reqToken() on top — so this is the whole of what
  // reviewing costs. Commenting on a change needs CanReadIssuesOrPulls, which
  // for a pull request is the same read on repo.pulls.
  const reviewers = await post<{ id: number }>(admin, `/orgs/${org}/teams`, {
    name: `${repo}-reviewers`,
    permission: "read",
    units_map: {
      "repo.code": "read",
      "repo.pulls": "read",
      "repo.issues": "read",
    },
  });

  for (const team of [admins, authors, reviewers]) {
    await put(admin, `/teams/${team.id}/repos/${org}/${repo}`);
  }
  await put(admin, `/teams/${authors.id}/members/${AUTHOR}`);
  await put(admin, `/teams/${reviewers.id}/members/${REVIEWER}`);

  await post(admin, `/repos/${org}/${repo}/branch_protections`, {
    rule_name: "main",
    required_approvals: 1,
    enable_push: false,
    block_on_rejected_reviews: true,
    block_on_official_review_requests: true,
    dismiss_stale_approvals: true,
    enable_approvals_whitelist: options.enableApprovalsWhitelist,
    ...(options.enableApprovalsWhitelist
      ? {
          approvals_whitelist_teams: [
            `${repo}-admins`,
            `${repo}-authors`,
            `${repo}-reviewers`,
          ],
        }
      : {}),
  });

  return {
    org,
    repo,
    adminsTeamId: admins.id,
    authorsTeamId: authors.id,
    reviewersTeamId: reviewers.id,
  };
}

/** Commit `path` on a fresh branch and open a change for it. */
async function openChange(
  client: GiteaClient,
  workspace: Workspace,
  path: string,
  content: string,
): Promise<number> {
  const branch = `change/${Date.now().toString(36)}`;
  await post(client, `/repos/${workspace.org}/${workspace.repo}/branches`, {
    new_branch_name: branch,
    old_ref_name: "main",
  });
  await post(
    client,
    `/repos/${workspace.org}/${workspace.repo}/contents/${path}`,
    {
      branch,
      content: Buffer.from(content).toString("base64"),
      message: `Add ${path}`,
    },
  );
  const pull = await post<{ number: number }>(
    client,
    `/repos/${workspace.org}/${workspace.repo}/pulls`,
    { head: branch, base: "main", title: `Revise ${path}` },
  );
  return pull.number;
}

interface ReviewResult {
  id: number;
  official: boolean;
  state: string;
}

async function approve(
  client: GiteaClient,
  workspace: Workspace,
  index: number,
): Promise<ReviewResult> {
  return post<ReviewResult>(
    client,
    `/repos/${workspace.org}/${workspace.repo}/pulls/${index}/reviews`,
    { event: "APPROVED", body: "Approved." },
  );
}

/** Attempt a merge; resolve with the Gitea status rather than throwing. */
async function tryMerge(
  client: GiteaClient,
  workspace: Workspace,
  index: number,
): Promise<{ ok: boolean; status: number; message: string }> {
  await waitForMergeCheck(client, workspace, index);

  try {
    await post(
      client,
      `/repos/${workspace.org}/${workspace.repo}/pulls/${index}/merge`,
      { Do: "merge" },
    );
    return { ok: true, status: 200, message: "" };
  } catch (err) {
    if (err instanceof GiteaApiError) {
      return { ok: false, status: err.status, message: err.message };
    }
    throw err;
  }
}

test.describe("ADR 0004: the Gitea permission model the workspace rests on", () => {
  let admin: GiteaClient;
  let author: GiteaClient;
  let reviewer: GiteaClient;

  test.beforeAll(async () => {
    admin = await createUserClient(GITEA_ADMIN_USER);
    author = await createUserClient(AUTHOR);
    reviewer = await createUserClient(REVIEWER);
  });

  test("a reviewer without write access can approve, and the approval counts", async () => {
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
    });
    const index = await openChange(
      author,
      workspace,
      "policies/nursing/handover.md",
      "Handover policy, v1.\n",
    );

    // The permission is real, and the proof is not branch protection: creating
    // a branch is guarded by reqRepoWriter(unit.TypeCode), which the reviewer
    // team does not have. A reviewer cannot start a version, let alone land one.
    let branchStatus = 0;
    try {
      await post(
        reviewer,
        `/repos/${workspace.org}/${workspace.repo}/branches`,
        {
          new_branch_name: "reviewer-should-not-get-here",
          old_ref_name: "main",
        },
      );
    } catch (err) {
      branchStatus = err instanceof GiteaApiError ? err.status : 0;
    }
    expect(branchStatus).toBe(403);

    const review = await approve(reviewer, workspace, index);
    expect(review.state).toBe("APPROVED");
    // `official` is the whole ball game: GetGrantedApprovalsCount counts only
    // official approvals, so a non-official one satisfies nothing.
    expect(review.official).toBe(true);

    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });

  test("the approval does not count without the approvals whitelist", async () => {
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: false,
    });
    const index = await openChange(
      author,
      workspace,
      "policies/nursing/handover.md",
      "Handover policy, v1.\n",
    );

    const review = await approve(reviewer, workspace, index);
    expect(review.state).toBe("APPROVED");
    // Default officialness is "has write access on repo.code", which a free
    // reviewer does not. The review is recorded and counts for nothing.
    expect(review.official).toBe(false);

    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok).toBe(false);
    expect(merge.message).toContain("approvals");
  });

  test("CODEOWNERS plus block_on_official_review_requests blocks the merge", async () => {
    // CODEOWNERS is read from the base repo's default branch, never from the
    // change under review. Gitea's patterns are anchored regexes (^...$), not
    // gitignore globs: a bare directory prefix matches nothing, hence `.*`.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      codeowners: (org, repo) =>
        `policies/nursing/.*  @${org}/${repo}-reviewers\n`,
    });

    const index = await openChange(
      author,
      workspace,
      "policies/nursing/infection-control.md",
      "Infection control policy, v1.\n",
    );

    const reviews = await (async () => {
      const untyped = admin as unknown as {
        GET: (p: string) => Promise<{
          data?: Array<Record<string, unknown>>;
          response: Response;
        }>;
      };
      const { data } = await untyped.GET(
        `/repos/${workspace.org}/${workspace.repo}/pulls/${index}/reviews`,
      );
      return data ?? [];
    })();

    // The requested reviewer is the team named by CODEOWNERS, and the request
    // is official — which is what makes it block anything.
    const teamRequest = reviews.find(
      (review) => review.state === "REQUEST_REVIEW",
    );
    expect(teamRequest).toBeDefined();
    expect(teamRequest?.official).toBe(true);

    const blocked = await tryMerge(author, workspace, index);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("official review requests");

    // A code owner reviewing clears the team request and unblocks the merge.
    await approve(reviewer, workspace, index);
    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });
});
