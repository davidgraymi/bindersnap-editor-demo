import type { components } from "./spec/gitea";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";
import {
  createOrganization,
  createWorkspaceTeams,
  findOrganization,
  grantTeamOnRepo,
  workspaceTeamName,
  WORKSPACE_ROLES,
  type GiteaOrganization,
  type GiteaTeam,
  type WorkspaceRole,
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
  teams: Record<WorkspaceRole, GiteaTeam>;
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
}

/** The repository, its three role teams, and a protected `main`. */
export async function provisionWorkspace(
  params: ProvisionWorkspaceParams,
): Promise<ProvisionedWorkspace> {
  const { client, org, name, description, requiredApprovals } = params;

  const workspace = await createWorkspaceRepo({
    client,
    org,
    name,
    description,
  });

  const teams = await createWorkspaceTeams({ client, org, workspace: name });

  for (const role of WORKSPACE_ROLES) {
    await grantTeamOnRepo({
      client,
      teamId: teams[role].id,
      org,
      repo: name,
    });
  }

  // Protection last: the teams have to exist before they can be whitelisted.
  await protectWorkspaceMain({
    client,
    org,
    workspace: name,
    requiredApprovals,
  });

  return { workspace, teams };
}

export interface ProvisionOrganizationParams {
  client: GiteaClient;
  /** The org's Gitea username. */
  orgName: string;
  orgFullName?: string;
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
  const { client, orgName, orgFullName } = params;

  const organization =
    (await findOrganization({ client, org: orgName })) ??
    (await createOrganization({
      client,
      name: orgName,
      fullName: orgFullName,
    }));

  return { organization };
}
