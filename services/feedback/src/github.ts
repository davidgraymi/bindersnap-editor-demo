/**
 * Open an issue as the feedback GitHub App.
 *
 * Three calls, none cached: the app's JWT finds the app's installation on the
 * repository, the installation gives a token good for an hour, and the token
 * opens the issue. A Worker keeps nothing between requests (ADR 0006), and
 * feedback is rare enough that the two extra round trips cost nothing.
 */

import githubAppJwt from "universal-github-app-jwt";

import type { FeedbackIssue } from "./issue";

const GITHUB_API = "https://api.github.com";

export interface GitHubAppConfig {
  appId: string;
  /** The PEM GitHub hands out (PKCS#1). Literal `\n` are accepted too. */
  privateKey: string;
  /** `owner/name` of the private feedback repository. */
  repository: string;
}

export class GitHubError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
  ) {
    super(`GitHub ${step} failed with ${status}`);
  }
}

export async function createIssue(
  config: GitHubAppConfig,
  issue: FeedbackIssue,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const { token: jwt } = await githubAppJwt({
    id: config.appId,
    privateKey: config.privateKey.replace(/\\n/g, "\n"),
  });

  const installation = await call<{ id: number }>(
    fetcher,
    "find installation",
    `/repos/${config.repository}/installation`,
    jwt,
  );
  const { token } = await call<{ token: string }>(
    fetcher,
    "get token",
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    { method: "POST" },
  );
  await call(
    fetcher,
    "create issue",
    `/repos/${config.repository}/issues`,
    token,
    {
      method: "POST",
      body: JSON.stringify(issue),
    },
  );
}

async function call<T = unknown>(
  fetcher: typeof fetch,
  step: string,
  path: string,
  bearer: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetcher(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      // GitHub refuses requests without one.
      "User-Agent": "bindersnap-feedback",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new GitHubError(step, response.status);
  return (await response.json()) as T;
}
