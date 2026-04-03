import type { components } from "./spec/gitea";

import { unwrap, type GiteaClient } from "./client";

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
