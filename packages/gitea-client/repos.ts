import type { Repository, Tag } from "gitea-js";

import { GiteaApiError, type GiteaClient } from "./client";

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

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const responseLike = error as {
      error?: unknown;
      message?: unknown;
      statusText?: unknown;
    };

    if (
      typeof responseLike.message === "string" &&
      responseLike.message.trim() !== ""
    ) {
      return responseLike.message;
    }

    if (
      typeof responseLike.error === "string" &&
      responseLike.error.trim() !== ""
    ) {
      return responseLike.error;
    }

    if (
      typeof responseLike.error === "object" &&
      responseLike.error !== null &&
      "message" in responseLike.error &&
      typeof (responseLike.error as { message?: unknown }).message === "string"
    ) {
      return (responseLike.error as { message: string }).message;
    }

    if (
      typeof responseLike.statusText === "string" &&
      responseLike.statusText.trim() !== ""
    ) {
      return responseLike.statusText;
    }
  }

  return "Gitea request failed.";
}

function toGiteaApiError(error: unknown): GiteaApiError {
  if (error instanceof GiteaApiError) {
    return error;
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;

  return new GiteaApiError(
    Number.isFinite(status) ? status : 0,
    readErrorMessage(error),
  );
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

  const version = Number.parseInt(match[1], 10);
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
  try {
    const response = await client.repos.repoSearch({
      limit: 100,
    });

    return response.data.data?.map(normalizeWorkspaceRepo) ?? [];
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function getLatestDocTag(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<DocTag | null> {
  try {
    const response = await client.repos.repoListTags(owner, repo, {
      limit: 100,
    });

    const tags = response.data
      .map(normalizeDocTag)
      .filter((tag): tag is DocTag => tag !== null);

    if (tags.length === 0) {
      return null;
    }

    tags.sort((a, b) => b.version - a.version);
    return tags[0];
  } catch (error) {
    throw toGiteaApiError(error);
  }
}

export async function listDocTags(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<DocTag[]> {
  try {
    const response = await client.repos.repoListTags(owner, repo, {
      limit: 100,
    });

    const tags = response.data
      .map(normalizeDocTag)
      .filter((tag): tag is DocTag => tag !== null);

    tags.sort((a, b) => b.version - a.version);
    return tags;
  } catch (error) {
    throw toGiteaApiError(error);
  }
}
