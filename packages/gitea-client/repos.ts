import type { components } from "./spec/gitea";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";

type Repository = components["schemas"]["Repository"];
type Tag = components["schemas"]["Tag"];
type BranchProtection = components["schemas"]["BranchProtection"];
type User = components["schemas"]["User"];
type RepoCollaboratorPermission =
  components["schemas"]["RepoCollaboratorPermission"];
type CreateBranchProtectionOption =
  components["schemas"]["CreateBranchProtectionOption"];
type AddCollaboratorOption = components["schemas"]["AddCollaboratorOption"];
type RepoFileContent = {
  sha?: string;
  type?: string;
};

export interface WorkspaceRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  updated_at: string;
  owner: { login: string };
}

export interface DocTag {
  name: string;
  version: number;
  sha: string;
  created: string;
}

export interface CreatePrivateCurrentUserRepoParams {
  client: GiteaClient;
  name: string;
  description?: string;
}

export interface CreateMainBranchProtectionParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  requiredApprovals?: number;
}

export interface BootstrapEmptyMainBranchParams {
  client: GiteaClient;
  owner: string;
  repo: string;
}

export interface RepoUserSummary {
  id: number;
  login: string;
  full_name: string;
  email: string;
  avatar_url: string;
}

export type RepoCollaboratorAccess = "read" | "write" | "admin";
export type RepoCollaboratorRole = RepoCollaboratorAccess | "owner" | "unknown";

export interface RepoCollaboratorPermissionSummary {
  permission: string;
  access: RepoCollaboratorRole;
  permissionLabel: string;
  roleName: string;
  user: RepoUserSummary;
}

export interface RepoCollaboratorListResult {
  collaborators: RepoCollaboratorPermissionSummary[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SearchUsersResult {
  users: RepoUserSummary[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ListRepoCollaboratorsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  page?: number;
  limit?: number;
}

export interface GetRepoCollaboratorPermissionParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  collaborator: string;
}

export interface GetCurrentUserRepoPermissionParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  username: string;
}

export interface AddRepoCollaboratorParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  collaborator: string;
  permission: RepoCollaboratorAccess;
}

export interface SearchUsersParams {
  client: GiteaClient;
  query: string;
  page?: number;
  limit?: number;
}

function normalizeWorkspaceRepo(repo: Repository): WorkspaceRepo {
  return {
    id: repo.id ?? 0,
    name: repo.name ?? "",
    full_name: repo.full_name ?? "",
    description: repo.description ?? "",
    updated_at: repo.updated_at ?? "",
    owner: {
      login: repo.owner?.login ?? "",
    },
  };
}

function normalizeUser(
  user: Partial<User> | null | undefined,
): RepoUserSummary {
  return {
    id: user.id ?? 0,
    login: user.login ?? "",
    full_name: user.full_name ?? "",
    email: user.email ?? "",
    avatar_url: user.avatar_url ?? "",
  };
}

function normalizeRepoCollaboratorAccess(
  permission: string,
): RepoCollaboratorRole {
  switch (permission) {
    case "read":
    case "write":
    case "admin":
    case "owner":
      return permission;
    default:
      return "unknown";
  }
}

function formatRepoCollaboratorPermissionLabel(
  permission: RepoCollaboratorRole,
): string {
  switch (permission) {
    case "read":
      return "Read";
    case "write":
      return "Write";
    case "admin":
      return "Admin";
    case "owner":
      return "Owner";
    default:
      return "Unknown";
  }
}

function normalizeRepoCollaboratorPermission(
  raw: RepoCollaboratorPermission,
): RepoCollaboratorPermissionSummary {
  const permission = raw.permission ?? "";
  const access = normalizeRepoCollaboratorAccess(permission);

  return {
    permission,
    access,
    permissionLabel: formatRepoCollaboratorPermissionLabel(access),
    roleName: raw.role_name ?? "",
    user: normalizeUser(raw.user),
  };
}

function parseDocTagVersion(tagName: string): number | null {
  const match = /^doc\/v(\d{4})$/.exec(tagName);
  if (!match) {
    return null;
  }

  const version = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(version) && version > 0 ? version : null;
}

function normalizeDocTag(tag: Tag): DocTag | null {
  const name = tag.name ?? "";
  const version = parseDocTagVersion(name);

  if (version === null) {
    return null;
  }

  return {
    name,
    version,
    sha: tag.commit?.sha ?? "",
    created: tag.commit?.created ?? "",
  };
}

export async function listWorkspaceRepos(
  client: GiteaClient,
): Promise<WorkspaceRepo[]> {
  const result = await unwrap(
    client.GET("/repos/search", {
      params: { query: { limit: 100 } },
    }),
  );

  return result.data?.map(normalizeWorkspaceRepo) ?? [];
}

export async function createPrivateCurrentUserRepo(
  params: CreatePrivateCurrentUserRepoParams,
): Promise<Repository> {
  const { client, name, description } = params;

  return await unwrap(
    client.POST("/user/repos", {
      body: {
        name,
        description,
        private: true,
        auto_init: true,
        default_branch: "main",
      },
    }),
  );
}

async function loadRepoCollaboratorPermission(
  client: GiteaClient,
  owner: string,
  repo: string,
  collaborator: string,
): Promise<RepoCollaboratorPermissionSummary> {
  const permission = await unwrap(
    client.GET(
      "/repos/{owner}/{repo}/collaborators/{collaborator}/permission",
      {
        params: {
          path: { owner, repo, collaborator },
        },
      },
    ),
  );

  return normalizeRepoCollaboratorPermission(permission);
}

export async function listRepoCollaborators(
  params: ListRepoCollaboratorsParams,
): Promise<RepoCollaboratorListResult> {
  const { client, owner, repo, page = 1, limit = 20 } = params;

  const collaborators = await unwrap(
    client.GET("/repos/{owner}/{repo}/collaborators", {
      params: {
        path: { owner, repo },
        query: { page, limit },
      },
    }),
  );

  const collaboratorsWithPermissions = await Promise.all(
    collaborators.map(async (collaborator) => {
      const user = normalizeUser(collaborator);
      const permission = await loadRepoCollaboratorPermission(
        client,
        owner,
        repo,
        user.login,
      );

      return {
        ...permission,
        user,
      };
    }),
  );

  return {
    collaborators: collaboratorsWithPermissions,
    page,
    limit,
    hasMore: collaborators.length === limit,
  };
}

export async function getRepoCollaboratorPermission(
  params: GetRepoCollaboratorPermissionParams,
): Promise<RepoCollaboratorPermissionSummary> {
  const { client, owner, repo, collaborator } = params;
  return await loadRepoCollaboratorPermission(
    client,
    owner,
    repo,
    collaborator,
  );
}

export async function getCurrentUserRepoPermission(
  params: GetCurrentUserRepoPermissionParams,
): Promise<RepoCollaboratorPermissionSummary> {
  const { client, owner, repo, username } = params;
  return await loadRepoCollaboratorPermission(client, owner, repo, username);
}

export async function addRepoCollaborator(
  params: AddRepoCollaboratorParams,
): Promise<void> {
  const { client, owner, repo, collaborator, permission } = params;

  await unwrap(
    client.PUT("/repos/{owner}/{repo}/collaborators/{collaborator}", {
      params: { path: { owner, repo, collaborator } },
      body: {
        permission,
      } satisfies AddCollaboratorOption,
    }),
  );
}

export async function searchUsers(
  params: SearchUsersParams,
): Promise<SearchUsersResult> {
  const { client, query, page = 1, limit = 10 } = params;

  const result = await unwrap(
    client.GET("/users/search", {
      params: {
        query: {
          q: query,
          page,
          limit,
        },
      },
    }),
  );

  const users = (result.data ?? []).map(normalizeUser);

  return {
    users,
    page,
    limit,
    hasMore: users.length === limit,
  };
}

export async function repoExists(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<boolean> {
  try {
    await unwrap(
      client.GET("/repos/{owner}/{repo}", {
        params: { path: { owner, repo } },
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

function normalizeBranchProtection(
  raw: BranchProtection,
): RepoBranchProtection {
  return {
    requiredApprovals: raw.required_approvals ?? 0,
    enableApprovalsWhitelist: raw.enable_approvals_whitelist ?? false,
    approvalsWhitelistUsernames: raw.approvals_whitelist_username ?? [],
    enableMergeWhitelist: raw.enable_merge_whitelist ?? false,
    mergeWhitelistUsernames: raw.merge_whitelist_usernames ?? [],
    blockOnRejectedReviews: raw.block_on_rejected_reviews ?? false,
  };
}

export async function createMainBranchProtection(
  params: CreateMainBranchProtectionParams,
): Promise<RepoBranchProtection> {
  const { client, owner, repo, requiredApprovals = 0 } = params;

  const protection = await unwrap(
    client.POST("/repos/{owner}/{repo}/branch_protections", {
      params: { path: { owner, repo } },
      body: {
        rule_name: "main",
        required_approvals: requiredApprovals,
        enable_approvals_whitelist: false,
        enable_merge_whitelist: false,
        block_on_rejected_reviews: true,
        block_on_outdated_branch: true,
        dismiss_stale_approvals: true,
        enable_force_push: false,
        enable_push: false,
      } satisfies CreateBranchProtectionOption,
    }),
  );

  return normalizeBranchProtection(protection);
}

export async function bootstrapEmptyMainBranch(
  params: BootstrapEmptyMainBranchParams,
): Promise<void> {
  const { client, owner, repo } = params;

  let readme: RepoFileContent | RepoFileContent[] | null = null;

  try {
    readme = await unwrap(
      client.GET("/repos/{owner}/{repo}/contents/{filepath}", {
        params: {
          path: { owner, repo, filepath: "README.md" },
          query: { ref: "main" },
        },
      }),
    );
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return;
    }
    throw err;
  }

  if (Array.isArray(readme) || typeof readme?.sha !== "string") {
    return;
  }

  await unwrap(
    client.DELETE("/repos/{owner}/{repo}/contents/{filepath}", {
      params: {
        path: { owner, repo, filepath: "README.md" },
      },
      body: {
        branch: "main",
        sha: readme.sha,
        message: "Bootstrap empty main branch",
      },
    }),
  );
}

export async function getLatestDocTag(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<DocTag | null> {
  const tags = await unwrap(
    client.GET("/repos/{owner}/{repo}/tags", {
      params: {
        path: { owner, repo },
        query: { limit: 100 },
      },
    }),
  );

  const docTags = tags
    .map(normalizeDocTag)
    .filter((tag): tag is DocTag => tag !== null);

  if (docTags.length === 0) {
    return null;
  }

  docTags.sort((a, b) => b.version - a.version);
  return docTags[0] ?? null;
}

export async function listDocTags(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<DocTag[]> {
  const tags = await unwrap(
    client.GET("/repos/{owner}/{repo}/tags", {
      params: {
        path: { owner, repo },
        query: { limit: 100 },
      },
    }),
  );

  const docTags = tags
    .map(normalizeDocTag)
    .filter((tag): tag is DocTag => tag !== null);

  docTags.sort((a, b) => b.version - a.version);
  return docTags;
}

export interface RepoBranchProtection {
  requiredApprovals: number;
  enableApprovalsWhitelist: boolean;
  approvalsWhitelistUsernames: string[];
  enableMergeWhitelist: boolean;
  mergeWhitelistUsernames: string[];
  blockOnRejectedReviews: boolean;
}

export async function getRepoBranchProtection(
  client: GiteaClient,
  owner: string,
  repo: string,
  branchName: string,
): Promise<RepoBranchProtection | null> {
  const rules = await unwrap(
    client.GET("/repos/{owner}/{repo}/branch_protections", {
      params: { path: { owner, repo } },
    }),
  );

  const exact = rules.find((r) => r.rule_name === branchName);
  const rule = exact ?? rules[0] ?? null;

  return rule ? normalizeBranchProtection(rule) : null;
}

export interface CreateDocTagParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  version: number;
  target: string;
}

export async function createDocTag(
  params: CreateDocTagParams,
): Promise<DocTag> {
  const { client, owner, repo, version, target } = params;
  const versionStr = version.toString().padStart(4, "0");
  const tagName = `doc/v${versionStr}`;

  const tag = await unwrap(
    client.POST("/repos/{owner}/{repo}/tags", {
      params: { path: { owner, repo } },
      body: {
        tag_name: tagName,
        target,
        message: `Published version ${versionStr}`,
      },
    }),
  );

  const docTag = normalizeDocTag(tag);
  if (!docTag) {
    throw new GiteaApiError(0, `Failed to parse created tag: ${tagName}`);
  }
  return docTag;
}
