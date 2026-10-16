/**
 * The questions a person's own account raises before it is deleted.
 *
 * Gitea deletes accounts itself, and keeps everything that refers to one by
 * id — reviews, comments, published versions — on the record. What it cannot
 * see is a **draft**: the branch `draft/<login>/<stamp>`, whose owner is read
 * from that name. A deleted account's drafts are retired out of `draft/`, so a
 * future account that takes the same login cannot pick them up.
 *
 * Logins never change. A rename was supported once, and it had to chase every
 * place that names somebody as text — sign-off rules, drafts, sessions — for
 * a change nobody needed.
 */

import {
  readAllPages,
  toGiteaApiError,
  unwrap,
  type GiteaClient,
} from "./gitea-client/client";
import { draftOwner } from "./gitea-client/drafts";
import { listOrganizationOwners } from "./gitea-client/orgs";
import { listOrganizationWorkspaces } from "./gitea-client/workspaces";

/** Every organization this person is in, by name. */
export async function listUserOrganizations(
  client: GiteaClient,
  username: string,
): Promise<string[]> {
  // Every page: `limit: 100` answers with 50.
  const orgs = await readAllPages((query) =>
    unwrap(
      client.GET("/users/{username}/orgs", {
        params: { path: { username }, query },
      }),
    ),
  );
  return orgs
    .map((org) => org.username ?? org.name ?? "")
    .filter((name) => name !== "");
}

/**
 * The organizations this person is the only owner of.
 *
 * Gitea refuses to leave an organization with no owner, and so does this:
 * deleting the last owner's account would leave the binders, the billing and
 * the people in it with nobody who can run any of them.
 */
export async function findSoleOwnerships(params: {
  client: GiteaClient;
  username: string;
  orgs: readonly string[];
}): Promise<string[]> {
  const { client, username, orgs } = params;
  const login = username.toLowerCase();
  const sole: string[] = [];

  for (const org of orgs) {
    const owners = await listOrganizationOwners({ client, org });
    const isOwner = owners.some((owner) => owner.login.toLowerCase() === login);
    if (isOwner && owners.length === 1) sole.push(org);
  }

  return sole;
}

/** One of a person's drafts, in one binder. */
export interface OwnedDraft {
  org: string;
  binder: string;
  giteaRepoId: number;
  branch: string;
}

/** Every draft branch this person has, across their organizations. */
export async function listOwnedDrafts(params: {
  client: GiteaClient;
  username: string;
  orgs: readonly string[];
}): Promise<OwnedDraft[]> {
  const { client, username, orgs } = params;
  const login = username.toLowerCase();
  const drafts: OwnedDraft[] = [];

  for (const org of orgs) {
    const binders = await listOrganizationWorkspaces({ client, org });
    for (const binder of binders) {
      // Every page. A busy binder has more than 50 branches, and a draft past
      // the first page was one this list never found.
      const branches = await readAllPages((query) =>
        unwrap(
          client.GET("/repos/{owner}/{repo}/branches", {
            params: { path: { owner: org, repo: binder.name }, query },
          }),
        ),
      ).catch(() => []);
      for (const row of branches) {
        const branch = row.name ?? "";
        if (draftOwner(branch)?.toLowerCase() === login) {
          drafts.push({
            org,
            binder: binder.name,
            giteaRepoId: binder.id,
            branch,
          });
        }
      }
    }
  }

  return drafts;
}

/** Rename one branch; Gitea moves an open change request's head with it. */
export async function renameBranch(params: {
  client: GiteaClient;
  org: string;
  binder: string;
  from: string;
  to: string;
}): Promise<void> {
  const { client, org, binder, from, to } = params;
  // Gitea answers 204 with no body, which `unwrap` would read as a failure.
  const { error, response } = await client.PATCH(
    "/repos/{owner}/{repo}/branches/{branch}",
    {
      params: { path: { owner: org, repo: binder, branch: from } },
      body: { name: to },
    },
  );
  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}
