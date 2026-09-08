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
 * A third block, added when dev moved to a Gitea 28.0.0 nightly, covers
 * `block_on_codeowner_reviews` — the field that turns a per-folder rule from
 * assignment into enforcement and lets it name a *team*. The two gates resolve
 * officialness differently and a design that conflates them will be quietly
 * wrong in one of them, so both are asserted here side by side.
 *
 * Both original claims hold, but only with `enable_approvals_whitelist: true`
 * and the role teams listed in `approvals_whitelist_teams`. Gitea's default for "who is an
 * official reviewer" is "anyone with write access on repo.code", which would
 * silently discard every free reviewer's approval. The `it does not count
 * without the whitelist` case below pins that trap in place so nobody removes
 * the whitelist as redundant.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 *
 * Everything this file provisions is torn down again — see `deleteOrg` and the
 * `afterAll` below. That is not tidiness. These organizations put the seeded
 * accounts (`bob`, `carol`, `dan`) into a second organization, and
 * `resolveSessionOrganization` answers with the *oldest* one a session belongs
 * to. Leave them behind and, once a run predates the org a developer created
 * in the dev stack, every seeded binder disappears from the app — the data is
 * intact, the wrong organization is being read. On a `SKIP_STACK=1` run
 * against `bun run up` this accumulates in a volume nobody rebuilds.
 */

import { randomUUID } from "node:crypto";

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
// A second free reviewer, so a change can reach its approval count without the
// code owner — which is the only way to observe the CODEOWNERS gate on its own.
const SECOND_REVIEWER = "dan";

/**
 * The prefix every organization this file creates carries.
 *
 * It is what makes the cleanup below safe to point at a live dev stack: only
 * a name starting with this is ever deleted.
 */
const ORG_PREFIX = "bs-adr4-";

/** Unique per run so repeated runs never collide inside one Gitea volume. */
function uniqueOrgName(): string {
  return `${ORG_PREFIX}${randomUUID().slice(0, 8)}`;
}

/** Every organization provisioned in this run, for `afterAll` to remove. */
const provisionedOrgs: string[] = [];

interface Workspace {
  org: string;
  repo: string;
  adminsTeamId: number;
  authorsTeamId: number;
  reviewersTeamId: number;
  /** Extra reviewer-level teams a CODEOWNERS rule can name, by suffix. */
  codeownerTeamIds: Record<string, number>;
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

async function del(client: GiteaClient, path: string): Promise<void> {
  const untyped = client as unknown as {
    DELETE: (
      p: string,
      init: Record<string, never>,
    ) => Promise<{ error?: unknown; response: Response }>;
  };
  const { error, response } = await untyped.DELETE(path, {});
  // 404 is success for a cleanup: the thing is gone, which is the goal.
  if ((error !== undefined || !response.ok) && response.status !== 404) {
    throw new GiteaApiError(response.status, JSON.stringify(error ?? {}));
  }
}

async function patch<T>(
  client: GiteaClient,
  path: string,
  body: unknown,
): Promise<T> {
  const untyped = client as unknown as {
    PATCH: (
      p: string,
      init: { body: unknown },
    ) => Promise<{ data?: T; error?: unknown; response: Response }>;
  };
  const { data, error, response } = await untyped.PATCH(path, { body });
  if (error !== undefined || !response.ok) {
    throw new GiteaApiError(response.status, JSON.stringify(error ?? {}));
  }
  return data as T;
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
 * Remove an organization this file created, repositories first.
 *
 * Gitea refuses to delete an organization that still owns repositories, so the
 * order is not optional. Cleanup never fails the run: a leftover org is a
 * nuisance to be reported, not a reason to turn a passing permission test red.
 */
async function deleteOrg(admin: GiteaClient, org: string): Promise<void> {
  if (!org.startsWith(ORG_PREFIX)) {
    // A guard, not a formality: everything below deletes, and the prefix is
    // the only thing separating this file's fixtures from a real workspace.
    throw new Error(
      `Refusing to delete an organization outside ${ORG_PREFIX}*: ${org}`,
    );
  }

  try {
    const repos = await get<Array<{ name?: string }>>(
      admin,
      `/orgs/${org}/repos?limit=50`,
    );
    for (const repo of repos ?? []) {
      if (repo.name) await del(admin, `/repos/${org}/${repo.name}`);
    }
    await del(admin, `/orgs/${org}`);
  } catch (err) {
    process.stderr.write(
      `[gitea-permission-model] could not remove ${org}: ${String(err)}\n`,
    );
  }
}

/**
 * Remove `bs-adr4-*` organizations left behind by earlier runs.
 *
 * A run that crashed, or any run from before this cleanup existed, leaves orgs
 * in a dev stack's Gitea volume that shadow the seeded one. Sweeping at the
 * start means a developer gets that fixed by running the suite, rather than by
 * destroying their stack's data with `bun run down`.
 */
async function sweepLeftoverOrgs(admin: GiteaClient): Promise<void> {
  let leftovers: string[] = [];
  try {
    // The fixture orgs are private, so only the site-admin listing sees them.
    const rows = await get<Array<{ username?: string }>>(
      admin,
      "/admin/orgs?limit=200",
    );
    leftovers = (rows ?? [])
      .map((row) => row.username ?? "")
      .filter((name) => name.startsWith(ORG_PREFIX));
  } catch (err) {
    process.stderr.write(
      `[gitea-permission-model] could not list organizations to sweep: ${String(err)}\n`,
    );
    return;
  }

  for (const org of leftovers) {
    await deleteOrg(admin, org);
  }
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
    /**
     * Gitea 28.0.0's per-rule CODEOWNERS gate. Off unless a test asks, so the
     * 1.27 cases below keep asserting the behaviour they were written for.
     */
    blockOnCodeownerReviews?: boolean;
    /**
     * The 1.27 gate. On by default because that is what the original claims
     * rest on; the 28.0.0 cases turn it off so a block can only have come from
     * the gate under test.
     */
    blockOnOfficialReviewRequests?: boolean;
    /**
     * Extra reviewer-level teams, one per entry, granted onto the repository
     * and whitelisted. A per-folder rule needs a team per folder, and the
     * binder's own `-reviewers` team holds everybody — so it cannot express
     * "the nursing owners" and "the HR owners" as different sets.
     */
    codeownerTeams?: Array<{ suffix: string; members: string[] }>;
  },
): Promise<Workspace> {
  const org = uniqueOrgName();
  const repo = "binder";

  // Recorded before the first call that can fail, so a half-provisioned
  // organization is still cleaned up.
  provisionedOrgs.push(org);
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
  await put(admin, `/teams/${reviewers.id}/members/${SECOND_REVIEWER}`);

  // Same unit map as `-reviewers`: a code owner is a reviewer, and the point of
  // these teams is only that they hold *different people*.
  const codeownerTeamIds: Record<string, number> = {};
  for (const spec of options.codeownerTeams ?? []) {
    const team = await post<{ id: number }>(admin, `/orgs/${org}/teams`, {
      name: `${repo}-${spec.suffix}`,
      permission: "read",
      units_map: {
        "repo.code": "read",
        "repo.pulls": "read",
        "repo.issues": "read",
      },
    });
    await put(admin, `/teams/${team.id}/repos/${org}/${repo}`);
    for (const member of spec.members) {
      await put(admin, `/teams/${team.id}/members/${member}`);
    }
    codeownerTeamIds[spec.suffix] = team.id;
  }

  await post(admin, `/repos/${org}/${repo}/branch_protections`, {
    rule_name: "main",
    required_approvals: 1,
    enable_push: false,
    block_on_rejected_reviews: true,
    block_on_official_review_requests:
      options.blockOnOfficialReviewRequests ?? true,
    // Gitea 28.0.0 (go-gitea PR #34995). Sending it to a 1.27 Gitea is
    // silently ignored, which is exactly why it is asserted rather than
    // assumed — see the round-trip test.
    block_on_codeowner_reviews: options.blockOnCodeownerReviews ?? false,
    // Production provisioning turns this on; these tests turn it off, because
    // its machinery is asynchronous and has nothing to do with what they
    // assert. Committing the change's file is a push to the head branch, which
    // queues Gitea's AddTestPullRequestTask; when that task lands after the
    // approval it sees the diff-to-merge-base as changed and dismisses every
    // approval (services/pull/pull.go). The approval is created official and
    // then silently uncounted, which reads exactly like "a free reviewer's
    // approval does not count" — the very thing under test.
    dismiss_stale_approvals: false,
    enable_approvals_whitelist: options.enableApprovalsWhitelist,
    ...(options.enableApprovalsWhitelist
      ? {
          approvals_whitelist_teams: [
            `${repo}-admins`,
            `${repo}-authors`,
            `${repo}-reviewers`,
            ...(options.codeownerTeams ?? []).map(
              (spec) => `${repo}-${spec.suffix}`,
            ),
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
    codeownerTeamIds,
  };
}

/** Commit `path` on a fresh branch and open a change for it. */
async function openChange(
  client: GiteaClient,
  workspace: Workspace,
  path: string,
  content: string,
): Promise<number> {
  return openChangeWithFiles(client, workspace, [{ path, content }]);
}

/**
 * The same, for a change that touches several files at once.
 *
 * ADR 0004 makes the change the unit of approval precisely so a revision can
 * span documents, and Gitea 28.0.0's CODEOWNERS gate is **per rule** — so
 * "one change, two folders, two sets of owners" is the shape that tells the
 * two apart. One file can never distinguish "one approval overall" from "an
 * approval per matched rule".
 */
async function openChangeWithFiles(
  client: GiteaClient,
  workspace: Workspace,
  files: Array<{ path: string; content: string }>,
): Promise<number> {
  const branch = `change/${randomUUID().slice(0, 8)}`;
  await post(client, `/repos/${workspace.org}/${workspace.repo}/branches`, {
    new_branch_name: branch,
    old_ref_name: "main",
  });
  for (const file of files) {
    await post(
      client,
      `/repos/${workspace.org}/${workspace.repo}/contents/${file.path}`,
      {
        branch,
        content: Buffer.from(file.content).toString("base64"),
        message: `Add ${file.path}`,
      },
    );
  }
  const pull = await post<{ number: number }>(
    client,
    `/repos/${workspace.org}/${workspace.repo}/pulls`,
    {
      head: branch,
      base: "main",
      title: `Revise ${files.map((file) => file.path).join(", ")}`,
    },
  );

  // Settle before anyone acts on the change. Gitea computes a new pull
  // request's state in the background, and a review submitted while that is
  // still running can be dismissed by it — `dismiss_stale_approvals` is on, as
  // it is in production. Waiting here is what makes these tests about
  // permissions rather than about timing.
  await waitForMergeCheck(client, workspace, pull.number);

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

/**
 * Wait until Gitea will actually count `expected` approvals toward
 * `required_approvals` — official, not dismissed.
 *
 * A review can come back `official: true` from the create call and still not
 * be counted a moment later, so asserting the response is not the same as
 * asserting the state a merge reads. Polling the same shape the merge check
 * reads turns any future divergence into a precise message rather than an
 * intermittent "does not have enough approvals".
 */
async function waitForCountedApprovals(
  reader: GiteaClient,
  workspace: Workspace,
  index: number,
  expected: number,
): Promise<void> {
  let seen: ReviewRow[] = [];

  for (let attempt = 0; attempt < 40; attempt += 1) {
    seen = await listReviews(reader, workspace, index);
    const counted = seen.filter(
      (review) =>
        review.state === "APPROVED" && review.official && !review.dismissed,
    );
    if (counted.length >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Expected ${expected} counted approval(s) on ${workspace.org}/${workspace.repo}#${index}, saw: ${JSON.stringify(seen)}`,
  );
}

interface ReviewRow {
  state?: string;
  official?: boolean;
  dismissed?: boolean;
  team?: unknown;
}

async function listReviews(
  client: GiteaClient,
  workspace: Workspace,
  index: number,
): Promise<ReviewRow[]> {
  return (
    (await get<ReviewRow[]>(
      client,
      `/repos/${workspace.org}/${workspace.repo}/pulls/${index}/reviews`,
    )) ?? []
  );
}

/**
 * Attempt a merge; resolve with the Gitea status rather than throwing.
 *
 * "Please try again later" is Gitea saying its merge check has not finished,
 * not a verdict on the change — and submitting a review re-queues that check,
 * so it can come back between the poll below and the merge call. Retrying on
 * that one message is what keeps a timing answer from being read as a
 * permission answer.
 */
async function tryMerge(
  client: GiteaClient,
  workspace: Workspace,
  index: number,
): Promise<{ ok: boolean; status: number; message: string }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await waitForMergeCheck(client, workspace, index);

    try {
      await post(
        client,
        `/repos/${workspace.org}/${workspace.repo}/pulls/${index}/merge`,
        { Do: "merge" },
      );
      return { ok: true, status: 200, message: "" };
    } catch (err) {
      if (!(err instanceof GiteaApiError)) throw err;
      if (!err.message.includes("Please try again later")) {
        return { ok: false, status: err.status, message: err.message };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `Gitea never finished the merge check for ${workspace.org}/${workspace.repo}#${index}.`,
  );
}

test.describe("ADR 0004: the Gitea permission model the workspace rests on", () => {
  let admin: GiteaClient;
  let author: GiteaClient;
  let reviewer: GiteaClient;
  let secondReviewer: GiteaClient;

  test.beforeAll(async () => {
    admin = await createUserClient(GITEA_ADMIN_USER);
    author = await createUserClient(AUTHOR);
    reviewer = await createUserClient(REVIEWER);
    secondReviewer = await createUserClient(SECOND_REVIEWER);

    await sweepLeftoverOrgs(admin);
  });

  test.afterAll(async () => {
    for (const org of provisionedOrgs.splice(0)) {
      await deleteOrg(admin, org);
    }
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
    await waitForCountedApprovals(admin, workspace, index, 1);

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

  test("a CODEOWNERS user blocks the merge even once the count is met", async () => {
    // CODEOWNERS is read from the base repo's default branch, never from the
    // change under review. Gitea's patterns are anchored regexes (^...$), not
    // gitignore globs: a bare directory prefix matches nothing, hence `.*`.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      codeowners: () => `policies/nursing/.*  @${REVIEWER}\n`,
    });

    const index = await openChange(
      author,
      workspace,
      "policies/nursing/infection-control.md",
      "Infection control policy, v1.\n",
    );

    const request = (await listReviews(admin, workspace, index)).find(
      (review) => review.state === "REQUEST_REVIEW",
    );
    expect(request).toBeDefined();
    // Official is what makes a request block anything.
    expect(request?.official).toBe(true);

    // Satisfy the approval count with somebody who is not the code owner.
    // Gitea checks approvals before it checks outstanding requests, so without
    // this the merge is refused for the wrong reason and the gate under test
    // is never reached.
    await approve(secondReviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const blocked = await tryMerge(author, workspace, index);
    expect(blocked.ok).toBe(false);
    // Enough approvals, and still refused: CODEOWNERS is enforcement over and
    // above the count, which is the whole claim.
    expect(blocked.message).toContain("official review requests");

    // The code owner reviewing clears the request and releases the merge.
    await approve(reviewer, workspace, index);
    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });

  test("a CODEOWNERS team is assigned but blocks nothing under the 1.27 gate", async () => {
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

    const request = (await listReviews(admin, workspace, index)).find(
      (review) => review.state === "REQUEST_REVIEW",
    );

    // The team is requested, so assignment works and reviewers are notified.
    expect(request).toBeDefined();
    expect(request?.team).toBeDefined();

    // But the request is not official, so nothing is blocked by it.
    //
    // models/issues/review.go: AddReviewRequest clears the official flag on a
    // user's previous reviews *before* creating the new request, while
    // AddTeamReviewRequest creates the request first and then runs
    // `UPDATE review SET official = false WHERE issue_id = ? AND
    // reviewer_team_id = ?` — which matches the row it just wrote. A team
    // request is therefore always official = false, and
    // MergeBlockedByOfficialReviewRequests filters on official = true.
    //
    // This is a Gitea bug rather than a design choice, and it is **still there
    // on the 28.0.0 nightly** — re-run 2026-09-08 and this case passes
    // unchanged. So the ordering fix is still the upstream contribution worth
    // making, and this remains the signal if a later Gitea makes it.
    //
    // What changed on 28.0.0 is not this. `block_on_codeowner_reviews` is a
    // *second* gate that ignores officialness entirely, so a team code owner
    // enforces under that one while still enforcing nothing under this one.
    // Both are true at once, which is why this case is kept rather than
    // rewritten — see the `Gitea 28.0.0` describe block below for the other
    // half. A binder that moves its CODEOWNERS to teams without also moving
    // its gate lands exactly here: rules that assign and enforce nothing.
    expect(request?.official).toBe(false);

    // Same shape as the user case: the count is met by somebody who is not a
    // code owner. There the merge is still refused; here it goes through, and
    // that difference is the finding.
    await approve(secondReviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });
});

/**
 * Gitea 28.0.0 — `block_on_codeowner_reviews`, exercised rather than read.
 *
 * Everything the design rests on for per-folder sign-off was read from the
 * merged diff of go-gitea PR #34995, never run. `gitea-28-findings.md` §6
 * lists exactly what to assert before depending on any of it, and this is that
 * list. The dev stack runs a digest-pinned `main-nightly`; production is still
 * 1.27.3, which does not have this field at all — so these cases are also the
 * thing that would fail loudly if somebody pointed dev back at a released tag
 * while the CODEOWNERS generator assumed the gate.
 *
 * **Two gates, two rules, and conflating them is the mistake to avoid.**
 * `block_on_official_review_requests` (1.27) blocks on an *official* request,
 * which a team request never is — the ordering bug in `AddTeamReviewRequest`
 * is still there on this build. `block_on_codeowner_reviews` (28.0.0) ignores
 * officialness entirely and asks, per matched rule, whether one of that rule's
 * owners approved. That is why teams work under the new gate and only under
 * the new gate, and why these tests turn the old one off: a block has to be
 * attributable to the gate under test.
 */
test.describe("Gitea 28.0.0: block_on_codeowner_reviews", () => {
  let admin: GiteaClient;
  let author: GiteaClient;
  let reviewer: GiteaClient;
  let secondReviewer: GiteaClient;

  test.beforeAll(async () => {
    admin = await createUserClient(GITEA_ADMIN_USER);
    author = await createUserClient(AUTHOR);
    reviewer = await createUserClient(REVIEWER);
    secondReviewer = await createUserClient(SECOND_REVIEWER);
  });

  test("the field round-trips through create, read and edit", async () => {
    // The cheapest possible falsification of "we are on a Gitea that has this".
    // A 1.27 Gitea accepts the POST and drops the field on the floor, so
    // reading it back is the only thing that distinguishes support from
    // silence — and silence here would mean a sign-off rule that enforces
    // nothing while every screen says it does.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      blockOnCodeownerReviews: true,
    });

    const created = await get<{ block_on_codeowner_reviews?: boolean }>(
      admin,
      `/repos/${workspace.org}/${workspace.repo}/branch_protections/main`,
    );
    expect(
      created.block_on_codeowner_reviews,
      "block_on_codeowner_reviews did not survive the create — is this Gitea 28.0.0?",
    ).toBe(true);

    await patch(
      admin,
      `/repos/${workspace.org}/${workspace.repo}/branch_protections/main`,
      { block_on_codeowner_reviews: false },
    );

    const edited = await get<{ block_on_codeowner_reviews?: boolean }>(
      admin,
      `/repos/${workspace.org}/${workspace.repo}/branch_protections/main`,
    );
    expect(edited.block_on_codeowner_reviews).toBe(false);
  });

  test("a team code owner blocks the merge, and a member's approval releases it", async () => {
    // The finding that retires ADR 0004's "name people, not teams". Under the
    // 1.27 gate this exact shape merges straight through — there is a test
    // above asserting precisely that — because a team review request is never
    // official. Under this gate the team is what the rule names and a member's
    // approval is what satisfies it.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      blockOnCodeownerReviews: true,
      blockOnOfficialReviewRequests: false,
      codeownerTeams: [{ suffix: "nursing", members: [REVIEWER] }],
      codeowners: (org, repo) =>
        `policies/nursing/.*  @${org}/${repo}-nursing\n`,
    });

    const index = await openChange(
      author,
      workspace,
      "policies/nursing/infection-control.md",
      "Infection control policy, v1.\n",
    );

    // Meet the approval count with somebody who is not a nursing owner, so a
    // refusal cannot be "not enough approvals" wearing a costume.
    await approve(secondReviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const blocked = await tryMerge(author, workspace, index);
    expect(
      blocked.ok,
      "the merge went through with the nursing rule unsatisfied",
    ).toBe(false);

    await approve(reviewer, workspace, index);
    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });

  test("the gate is per rule: one change over two folders needs both owners", async () => {
    // The claim that decides whether a sign-off rule means anything. ADR 0004
    // makes the change the unit of approval so a revision can span documents;
    // if the gate were "one code owner overall", a change that quietly added an
    // HR policy alongside a nursing one would ship on the nursing owner's
    // approval alone. Per rule is what makes cross-cutting revisions pull in
    // every owner, which the ADR calls out as falling out for free.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      blockOnCodeownerReviews: true,
      blockOnOfficialReviewRequests: false,
      codeownerTeams: [
        { suffix: "nursing", members: [REVIEWER] },
        { suffix: "hr", members: [SECOND_REVIEWER] },
      ],
      codeowners: (org, repo) =>
        `policies/nursing/.*  @${org}/${repo}-nursing\n` +
        `policies/hr/.*  @${org}/${repo}-hr\n`,
    });

    const index = await openChangeWithFiles(author, workspace, [
      {
        path: "policies/nursing/infection-control.md",
        content: "Infection control policy, v1.\n",
      },
      { path: "policies/hr/conduct.md", content: "Conduct policy, v1.\n" },
    ]);

    // The nursing owner approves. That is one approval, which meets
    // `required_approvals: 1` — and satisfies exactly one of the two rules.
    await approve(reviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const blocked = await tryMerge(author, workspace, index);
    expect(
      blocked.ok,
      "the count was met and one rule satisfied — the HR rule should still block",
    ).toBe(false);

    await approve(secondReviewer, workspace, index);
    const merge = await tryMerge(author, workspace, index);
    expect(merge.ok, `merge refused: ${merge.status} ${merge.message}`).toBe(
      true,
    );
  });

  test("a rule whose only owner is the author is waived, not unmergeable", async () => {
    // The one branch that *loosens* the gate, which is why it is worth a test
    // of its own: a mistake here is silent and permissive. An author cannot
    // approve their own change, so a rule naming only them could never be
    // satisfied — Gitea waives it rather than leaving the change permanently
    // stuck. If a future Gitea stops waiving, a generator that ever emits an
    // author-only rule would deadlock a binder, and this is what would say so.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      blockOnCodeownerReviews: true,
      blockOnOfficialReviewRequests: false,
      codeowners: () => `policies/nursing/.*  @${AUTHOR}\n`,
    });

    const index = await openChange(
      author,
      workspace,
      "policies/nursing/infection-control.md",
      "Infection control policy, v1.\n",
    );

    await approve(secondReviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const merge = await tryMerge(author, workspace, index);
    expect(
      merge.ok,
      `an author-only rule left the change unmergeable: ${merge.status} ${merge.message}`,
    ).toBe(true);
  });

  test("a pattern Gitea cannot compile is skipped, and its rule enforces nothing", async () => {
    // **This one came back the opposite way round to the design note, and the
    // difference matters more than the note did.**
    //
    // `gitea-28-findings.md` read the gate as failing closed on a CODEOWNERS
    // Gitea cannot handle. Reading `services/issue/pull.go` on `main` after
    // this test failed, that is true of exactly three things — the file
    // exceeding `MaxDisplayFileSize`, an unreadable blob, and rule matching
    // truncated by the aggregate match budget — and none of them is a bad
    // pattern. `GetCodeOwnersFromContent` returns `(rules, warnings)`, the
    // warnings go to the log, and the offending line is simply **absent from
    // `rules`**. `HasAllRequiredCodeownerReviews` then finds no matching rule
    // and returns `true`.
    //
    // So a rule whose pattern does not compile is not enforced, not reported,
    // and not visible anywhere a customer looks. That is precisely the failure
    // mode ADR 0004 complains about in `parseReviewSettings` — degrading
    // silently to the permissive policy, so a corrupt byte turns a control off
    // — living inside Gitea's own parser.
    //
    // The consequence for us is a requirement on the generator rather than a
    // bug to file: **every pattern it emits has to be known to compile**, and
    // a binder whose sign-off rules did not take effect must say so rather than
    // showing a rule that is enforcing nothing.
    const workspace = await provisionWorkspace(admin, {
      enableApprovalsWhitelist: true,
      blockOnCodeownerReviews: true,
      blockOnOfficialReviewRequests: false,
      // An unclosed character class: Gitea compiles each pattern as `^...$`,
      // so this cannot compile rather than merely matching nothing.
      codeowners: () => `policies/[nursing/.*  @${REVIEWER}\n`,
    });

    const index = await openChange(
      author,
      workspace,
      "policies/nursing/infection-control.md",
      "Infection control policy, v1.\n",
    );

    // The count is met by somebody who is not the intended code owner. If the
    // rule were in force this would be blocked, exactly as the team case above
    // is blocked by the same shape.
    await approve(secondReviewer, workspace, index);
    await waitForCountedApprovals(admin, workspace, index, 1);

    const merge = await tryMerge(author, workspace, index);
    expect(
      merge.ok,
      `a malformed rule blocked the merge — Gitea now fails closed on an ` +
        `uncompilable pattern, and the generator's validation can be relaxed: ` +
        `${merge.status} ${merge.message}`,
    ).toBe(true);
  });

  // Not exercised here, and named so the gap is a decision rather than an
  // oversight. The three genuine fail-closed paths in `getCodeOwnerRules` and
  // `HasAllRequiredCodeownerReviews` are a CODEOWNERS over
  // `setting.UI.MaxDisplayFileSize` (8 MiB by default), an unreadable blob, and
  // rule matching cut short by the aggregate match budget. Triggering the first
  // means committing an 8 MiB file through the contents API on every run;
  // shrinking the limit to make it cheap would change how every `.docx` in a
  // binder is handled, which is a worse trade than leaving this read from
  // source. The generator never emits a file within three orders of magnitude
  // of that size, so the path is unreachable in practice — the one above is
  // not.
});
