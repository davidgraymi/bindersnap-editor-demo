/**
 * Work on issues as the feedback GitHub App.
 *
 * The app's JWT finds the app's installation on the repository, the
 * installation gives a token good for an hour, and the token does the rest.
 * None of it is cached: a Worker keeps nothing between requests (ADR 0006),
 * and feedback and errors are rare enough that the two extra round trips cost
 * nothing.
 */

import githubAppJwt from "universal-github-app-jwt";

import type { FeedbackIssue } from "./issue";

const GITHUB_API = "https://api.github.com";

export interface GitHubAppConfig {
  appId: string;
  /** The PEM GitHub hands out (PKCS#1). Literal `\n` are accepted too. */
  privateKey: string;
  /** `owner/name` of the private repository: feedback's, or errors'. */
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

/** A repository's issues, as its installation. */
export interface IssueClient {
  create(issue: {
    title: string;
    body: string;
    labels: string[];
  }): Promise<{ number: number }>;
  /** Every issue, open or closed, whose title holds `text`; newest first. */
  searchTitles(text: string): Promise<FoundIssue[]>;
  comment(number: number, body: string): Promise<void>;
  /** Open it again, with these labels in place of the ones it had. */
  reopen(number: number, labels: string[]): Promise<void>;
}

export interface FoundIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  /** Why it was closed: `completed`, `not_planned`, or null. */
  state_reason: string | null;
  labels: { name: string }[];
}

export async function connect(
  config: GitHubAppConfig,
  fetcher: typeof fetch = fetch,
): Promise<IssueClient> {
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
  const issues = `/repos/${config.repository}/issues`;

  return {
    create: (issue) =>
      call(fetcher, "create issue", issues, token, {
        method: "POST",
        body: JSON.stringify(issue),
      }),
    async searchTitles(text) {
      const query = `repo:${config.repository} is:issue in:title "${text}"`;
      const found = await call<{ items: FoundIssue[] }>(
        fetcher,
        "search issues",
        `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=10`,
        token,
      );
      return found.items;
    },
    async comment(number, body) {
      await call(fetcher, "comment", `${issues}/${number}/comments`, token, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },
    async reopen(number, labels) {
      await call(fetcher, "reopen", `${issues}/${number}`, token, {
        method: "PATCH",
        body: JSON.stringify({ state: "open", labels }),
      });
    },
  };
}

export async function createIssue(
  config: GitHubAppConfig,
  issue: FeedbackIssue,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const client = await connect(config, fetcher);
  await client.create(issue);
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
