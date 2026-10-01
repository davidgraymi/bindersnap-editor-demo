/**
 * The questions a person's own account raises before it is renamed or deleted.
 *
 * Gitea renames and deletes accounts itself, and keeps everything that refers
 * to one by id — reviews, comments, team memberships — pointing at the right
 * place. What it cannot see are the places that refer to somebody **by login,
 * as text**, and Bindersnap has three:
 *
 * - **Sign-off rules.** `.gitea/CODEOWNERS` may name `@jkim`. Gitea reads the
 *   file at merge time; rename Jordan and the line names nobody, and the
 *   folder's sign-off quietly stops applying.
 * - **Drafts.** A draft is the branch `draft/<login>/<stamp>`, and whose it is
 *   is read from that name.
 * - **Sessions.** Each holds the login it was made for.
 *
 * Sign-off rules are changed by an approved change request, never written
 * behind the binder's back — so a rename that would break one is refused with
 * the list of binders to fix. Drafts and sessions are this person's own, so
 * they move with them.
 */

import { parseCodeowners } from "../../packages/utils/codeowners";

import {
  toGiteaApiError,
  unwrap,
  type GiteaClient,
} from "./gitea-client/client";
import { DRAFT_BRANCH_PREFIX, draftOwner } from "./gitea-client/drafts";
import { listOrganizationOwners } from "./gitea-client/orgs";
import { readSignOffFile } from "./gitea-client/signOff";
import { listOrganizationWorkspaces } from "./gitea-client/workspaces";

/** Every organization this person is in, by name. */
export async function listUserOrganizations(
  client: GiteaClient,
  username: string,
): Promise<string[]> {
  const orgs = await unwrap(
    client.GET("/users/{username}/orgs", {
      params: { path: { username }, query: { limit: 100 } },
    }),
  );
  return (orgs ?? [])
    .map((org) => org.username ?? org.name ?? "")
    .filter((name) => name !== "");
}

/** Whether a CODEOWNERS file names this login as a person who signs off. */
export function signOffNamesUser(
  org: string,
  content: string,
  username: string,
): boolean {
  const login = username.toLowerCase();
  return parseCodeowners(org, content).rules.some((rule) =>
    rule.users.some((user) => user.toLowerCase() === login),
  );
}

/** The binders whose sign-off rules name this person, as `org/binder`. */
export async function findSignOffMentions(params: {
  client: GiteaClient;
  username: string;
  orgs: readonly string[];
}): Promise<string[]> {
  const { client, username, orgs } = params;
  const mentions: string[] = [];

  for (const org of orgs) {
    const binders = await listOrganizationWorkspaces({ client, org });
    for (const binder of binders) {
      const file = await readSignOffFile({
        client,
        org,
        workspace: binder.name,
      }).catch(() => null);
      if (file && signOffNamesUser(org, file.content, username)) {
        mentions.push(`${org}/${binder.name}`);
      }
    }
  }

  return mentions;
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

/** `draft/jkim/20260919…` → `draft/jordan/20260919…`, or null if not theirs. */
export function renamedDraftBranch(
  branch: string,
  from: string,
  to: string,
): string | null {
  if (draftOwner(branch)?.toLowerCase() !== from.toLowerCase()) return null;
  const stamp = branch.slice(DRAFT_BRANCH_PREFIX.length).split("/")[1];
  return `${DRAFT_BRANCH_PREFIX}${to}/${stamp}`;
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
      const branches = await unwrap(
        client.GET("/repos/{owner}/{repo}/branches", {
          params: {
            path: { owner: org, repo: binder.name },
            query: { limit: 100 },
          },
        }),
      ).catch(() => []);
      for (const row of branches ?? []) {
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
