import type { components } from "./spec/gitea";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";
import { bootstrapEmptyMainBranch } from "./repos";
import {
  addTeamMember,
  createOrganization,
  ensureStaffTeam,
  findOrganization,
  grantTeamOnRepo,
  listRepoTeams,
  OWNERS_TEAM_NAME,
  workspaceTeamName,
  WORKSPACE_ROLES,
  type GiteaOrganization,
  type GiteaTeam,
} from "./orgs";

type Repository = components["schemas"]["Repository"];
type CreateRepoOption = components["schemas"]["CreateRepoOption"];
type CreateBranchProtectionOption =
  components["schemas"]["CreateBranchProtectionOption"];

/**
 * The workspace: a repository owned by the organization, with `main` protected
 * and the three role teams granted onto it. ADR 0004 §2 — "everything a
 * workspace has to be, a repository already is".
 *
 * Provisioning is idempotent end to end. Every step tolerates already having
 * run, so a partial failure is repaired by running it again rather than by
 * hand-cleaning the org.
 */

/** How many approvals a change needs before it can publish, by default. */
export const DEFAULT_REQUIRED_APPROVALS = 1;

export interface WorkspaceSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string;
}

export interface ProvisionedWorkspace {
  workspace: WorkspaceSummary;
  /** The org-wide read team, granted onto it because a new binder is open. */
  staff: GiteaTeam;
}

export interface ProvisionedOrganization {
  organization: GiteaOrganization;
}

function normalizeWorkspace(repo: Repository): WorkspaceSummary {
  return {
    id: repo.id ?? 0,
    name: repo.name ?? "",
    fullName: repo.full_name ?? "",
    owner: repo.owner?.login ?? "",
    description: repo.description ?? "",
  };
}

export interface CreateWorkspaceRepoParams {
  client: GiteaClient;
  org: string;
  name: string;
  description?: string;
}

/**
 * The binder itself. Private, and initialized so `main` exists before it is
 * protected — an unprotected empty repo has no branch to protect.
 */
export async function createWorkspaceRepo(
  params: CreateWorkspaceRepoParams,
): Promise<WorkspaceSummary> {
  const { client, org, name, description } = params;

  const existing = await findWorkspaceRepo({ client, org, name });
  if (existing) {
    return existing;
  }

  const repo = await unwrap(
    client.POST("/orgs/{org}/repos", {
      params: { path: { org } },
      body: {
        name,
        description,
        private: true,
        auto_init: true,
        default_branch: "main",
      } satisfies CreateRepoOption,
    }),
  );

  return normalizeWorkspace(repo);
}

export interface ListOrganizationWorkspacesParams {
  client: GiteaClient;
  org: string;
}

/**
 * The organization's binders.
 *
 * Gitea answers with the repositories this token can see, which is the right
 * answer rather than a convenient one: a member who cannot see a workspace has
 * no business being told it exists.
 */
export async function listOrganizationWorkspaces(
  params: ListOrganizationWorkspacesParams,
): Promise<WorkspaceSummary[]> {
  const { client, org } = params;

  const repos = await unwrap(
    client.GET("/orgs/{org}/repos", { params: { path: { org } } }),
  );

  return (repos ?? []).map(normalizeWorkspace);
}

export interface WorkspacePathExistsParams {
  client: GiteaClient;
  org: string;
  workspace: string;
  path: string;
  ref?: string;
}

/**
 * Whether something already sits at this path in the binder.
 *
 * A binder holds many documents now, so "is this name taken?" is a question
 * about a path rather than about a repository. Committing over an existing
 * document would rewrite somebody else's policy while looking like a new one.
 */
export async function workspacePathExists(
  params: WorkspacePathExistsParams,
): Promise<boolean> {
  const { client, org, workspace, path, ref = "main" } = params;

  try {
    await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner: org, repo: workspace, filepath: path },
          query: { ref },
        },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

export interface FindWorkspaceRepoParams {
  client: GiteaClient;
  org: string;
  name: string;
}

export async function findWorkspaceRepo(
  params: FindWorkspaceRepoParams,
): Promise<WorkspaceSummary | null> {
  const { client, org, name } = params;

  try {
    const repo = await unwrap(
      client.GET("/repos/{owner}/{repo}", {
        params: { path: { owner: org, repo: name } },
      }),
    );
    return normalizeWorkspace(repo);
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * What this caller may do in a binder, asked of Gitea as them.
 *
 * Not the collaborator endpoint: a binder's people get their access through
 * org teams, and Gitea answers `"none"` for team-derived access on both the
 * team's own `permission` and the repository's collaborator list. The only
 * honest answer is to ask for the repository as that member and read what
 * comes back on it.
 *
 * It decides which buttons are drawn, never whether an act is allowed —
 * Gitea's own check is still the one that refuses.
 */
export async function readWorkspaceAccess(params: {
  client: GiteaClient;
  org: string;
  name: string;
}): Promise<{ push: boolean; admin: boolean }> {
  const { client, org, name } = params;

  try {
    const repo = (await unwrap(
      client.GET("/repos/{owner}/{repo}", {
        params: { path: { owner: org, repo: name } },
      }),
    )) as { permissions?: { push?: boolean; admin?: boolean } };

    return {
      push: repo.permissions?.push === true,
      admin: repo.permissions?.admin === true,
    };
  } catch {
    // A binder this caller cannot see has already answered 404 elsewhere; a
    // failure here should cost them a button, not the page.
    return { push: false, admin: false };
  }
}

export interface ProtectWorkspaceMainParams {
  client: GiteaClient;
  org: string;
  workspace: string;
  requiredApprovals?: number;
  /**
   * The teams whose members' approvals count. Defaults to the workspace's three
   * role teams, which is what makes a free reviewer's approval real.
   */
  approvalsWhitelistTeams?: string[];
}

/**
 * Protect `main`, which is the product's core claim: the only way any file
 * changes is a merged, approved change.
 *
 * `enable_approvals_whitelist` is the field this whole design turns on. Gitea
 * counts only *official* approvals toward `required_approvals`, and with the
 * whitelist off it resolves "official reviewer" as "has write access on
 * repo.code" — which a free reviewer does not have. Their approval would be
 * recorded, shown in the UI, and satisfy nothing; their rejection would block
 * nothing; and a CODEOWNERS request would block no merge. Listing the role
 * teams here makes officialness team membership instead. Do not remove it as
 * redundant: `tests/gitea-permission-model.pw.ts` fails if you do, and the
 * failure is the point.
 */
export async function protectWorkspaceMain(
  params: ProtectWorkspaceMainParams,
): Promise<void> {
  const {
    client,
    org,
    workspace,
    requiredApprovals = DEFAULT_REQUIRED_APPROVALS,
  } = params;

  const approvalsWhitelistTeams =
    params.approvalsWhitelistTeams ??
    WORKSPACE_ROLES.map((role) => workspaceTeamName(workspace, role));

  const body = {
    rule_name: "main",
    required_approvals: requiredApprovals,
    enable_approvals_whitelist: true,
    approvals_whitelist_teams: approvalsWhitelistTeams,
    enable_merge_whitelist: false,
    block_on_rejected_reviews: true,
    block_on_official_review_requests: true,
    block_on_outdated_branch: true,
    dismiss_stale_approvals: true,
    enable_force_push: false,
    enable_push: false,
  } satisfies CreateBranchProtectionOption;

  // Gitea answers a duplicate rule with 403 "Branch protection already exist",
  // which is indistinguishable from a real permission denial. Asking first
  // keeps re-provisioning from swallowing an authorization error.
  const existing = await findMainBranchProtection({ client, org, workspace });

  if (existing) {
    // Update in place, so the settings above are what ends up on the branch
    // whether this is the first run or the fourth.
    await unwrap(
      client.PATCH("/repos/{owner}/{repo}/branch_protections/{name}", {
        params: { path: { owner: org, repo: workspace, name: "main" } },
        body,
      }),
    );
    return;
  }

  await unwrap(
    client.POST("/repos/{owner}/{repo}/branch_protections", {
      params: { path: { owner: org, repo: workspace } },
      body,
    }),
  );
}

interface FindMainBranchProtectionParams {
  client: GiteaClient;
  org: string;
  workspace: string;
}

async function findMainBranchProtection(
  params: FindMainBranchProtectionParams,
): Promise<boolean> {
  const { client, org, workspace } = params;

  try {
    await unwrap(
      client.GET("/repos/{owner}/{repo}/branch_protections/{name}", {
        params: { path: { owner: org, repo: workspace, name: "main" } },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

export interface ProvisionWorkspaceParams {
  client: GiteaClient;
  org: string;
  name: string;
  description?: string;
  requiredApprovals?: number;
  /**
   * Whether the whole organization can read it. Open is the decided default:
   * the common case is a policy manual everybody must be able to read in order
   * to attest to it, and making the common case a configuration step teaches
   * customers that access is fiddly. Asked at creation, because the moment
   * somebody is naming a binder is the moment they know whether it is the staff
   * handbook or HR investigations.
   */
  openToOrganization?: boolean;
}

/** The repository, its three role teams, and a protected `main`. */
/**
 * Rewrite a binder's approvals whitelist from the teams granted onto it.
 *
 * `enable_approvals_whitelist` is what makes a free reviewer's approval count
 * (ADR 0004, "Verified Against Gitea"): with it on, officialness resolves as
 * membership of a whitelisted team rather than as write access. The cost is
 * that the whitelist has to name every team whose members may approve, or their
 * approvals are recorded, displayed, and satisfy nothing — which is a failure
 * with no error message anywhere.
 *
 * So it is derived, never guessed: read the teams Gitea says are granted here,
 * and use those names.
 *
 * **Plus `Owners`, unconditionally.** Gitea gives the Owners team admin over
 * the whole organization implicitly — it is never granted onto a repository,
 * so a whitelist derived from the granted teams alone omits it and an
 * **owner's** approval silently stops counting. Whether that endpoint happens
 * to report `Owners` is not the point and must not be relied on; append it and
 * let a duplicate be harmless.
 */
export async function recomputeApprovalsWhitelist(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
}): Promise<string[]> {
  const { client, org, workspace } = params;

  const granted = await listRepoTeams({ client, owner: org, repo: workspace });
  const names = [
    ...new Set([...granted.map((team) => team.name), OWNERS_TEAM_NAME]),
  ];

  await unwrap(
    client.PATCH("/repos/{owner}/{repo}/branch_protections/{name}", {
      params: { path: { owner: org, repo: workspace, name: "main" } },
      body: {
        enable_approvals_whitelist: true,
        approvals_whitelist_teams: names,
      },
    }),
  );

  return names;
}

export async function provisionWorkspace(
  params: ProvisionWorkspaceParams,
): Promise<ProvisionedWorkspace> {
  const {
    client,
    org,
    name,
    description,
    requiredApprovals,
    openToOrganization = true,
  } = params;

  const workspace = await createWorkspaceRepo({
    client,
    org,
    name,
    description,
  });

  // Gitea's `auto_init` writes a README, which is the only way to get a `main`
  // to protect — but a binder holds policies, and a generated README is not
  // one. Left in place it lists as a document called "README", which is a file
  // nobody wrote showing up in front of a surveyor. Removing it leaves `main`
  // with a commit and no files, which is what an empty binder is.
  //
  // Before protection, necessarily: afterwards nothing may push to `main`.
  await bootstrapEmptyMainBranch({ client, owner: org, repo: name });

  // No role teams. In Gitea a team is an *organization* object that a
  // repository adopts, so creating three per binder inverts the model: it
  // manufactures objects nobody asked for — two of which stay empty forever —
  // and it makes a recurring group un-reusable, because a Quality Committee
  // that reviews three binders becomes three membership lists a human keeps in
  // step by hand. A binder's access is now exactly what has been granted onto
  // it, and a per-binder team is created lazily, on the first individual grant.
  //
  // Open is the decided default and the creator was asked, so a restricted
  // binder is a choice somebody made rather than a state it can drift into.
  // `staff` is still ensured either way: it is the organization's membership
  // list, and a restricted binder is a binder it is not granted onto — not a
  // reason for it to be missing.
  const staff = await ensureStaffTeam({ client, org });
  if (openToOrganization) {
    await grantTeamOnRepo({ client, teamId: staff.id, org, repo: name });
  }

  // Protection last, and its whitelist stated rather than recomputed: at this
  // moment the granted set is exactly what was just granted, and `Owners` is
  // never granted but must always be on the list. `recomputeApprovalsWhitelist`
  // is for afterwards, when a grant actually changes the set.
  await protectWorkspaceMain({
    client,
    org,
    workspace: name,
    requiredApprovals,
    approvalsWhitelistTeams: openToOrganization
      ? [staff.name, OWNERS_TEAM_NAME]
      : [OWNERS_TEAM_NAME],
  });

  return { workspace, staff };
}

export interface ProvisionOrganizationParams {
  client: GiteaClient;
  /** The org's Gitea username. */
  orgName: string;
  orgFullName?: string;
  /** Who is creating it. Gitea makes them an owner; this puts them in `staff`. */
  owner: string;
}

/**
 * The organization, and nothing else.
 *
 * It used to arrive with a binder called "policies" that nobody asked for.
 * Naming the container a customer's records live in is the owner's decision,
 * and guessing it produced a repository that no document ever went into —
 * documents are still their own repositories today, so the binder was created
 * and then ignored. A workspace is now something a member makes, with
 * `provisionWorkspace`, when they have one to make.
 *
 * The client's token decides who owns the organization — Gitea puts the
 * creating user in the Owners team — so this must be called with the new
 * user's own token, never the service account's.
 */
export async function provisionOrganization(
  params: ProvisionOrganizationParams,
): Promise<ProvisionedOrganization> {
  const { client, orgName, orgFullName, owner } = params;

  const organization =
    (await findOrganization({ client, org: orgName })) ??
    (await createOrganization({
      client,
      name: orgName,
      fullName: orgFullName,
    }));

  // Every member of the organization belongs to `staff`, so it exists from the
  // organization's first moment rather than being conjured by whichever binder
  // happens to be created first — **and the founder is put in it**, because a
  // team that exists and holds nobody makes "everyone at Riverside Health can
  // read this binder" a claim about an empty set. Gitea puts them in `Owners`,
  // which reaches every binder by a different route, so nothing visibly broke
  // while this was missing.
  //
  // Best-effort: an organization without `staff` is still an organization, and
  // `provisionWorkspace` makes it if it has to.
  await ensureStaffTeam({ client, org: organization.name })
    .then((staff) =>
      addTeamMember({ client, teamId: staff.id, username: owner }),
    )
    .catch(() => null);

  return { organization };
}
