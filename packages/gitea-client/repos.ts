import type { components } from "./spec/gitea";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";

type Repository = components["schemas"]["Repository"];
type Tag = components["schemas"]["Tag"];

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

function normalizeBranchProtection(
  raw: components["schemas"]["BranchProtection"],
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
