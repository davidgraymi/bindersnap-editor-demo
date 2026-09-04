import type { components } from "./spec/gitea";

import {
  GiteaApiError,
  toGiteaApiError,
  unwrap,
  type GiteaClient,
} from "./client";

type Organization = components["schemas"]["Organization"];
type Team = components["schemas"]["Team"];
type User = components["schemas"]["User"];
type CreateOrgOption = components["schemas"]["CreateOrgOption"];
type CreateTeamOption = components["schemas"]["CreateTeamOption"];

/**
 * The organization, its teams, and who is in them — ADR 0004's first level.
 *
 * The organization is who we bill and who your people are; a workspace is a
 * repository it owns; the three role teams below are granted onto that
 * repository and are the whole of "who can do what in a workspace". Nothing
 * here is mirrored into SQLite: membership and permissions are Gitea's, and a
 * copy that disagreed with Gitea would be a bug in the direction that matters.
 */

export const WORKSPACE_ROLES = ["admins", "authors", "reviewers"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Gitea's built-in owners team. Every org has exactly one, under this name. */
export const OWNERS_TEAM_NAME = "Owners";

/**
 * Access levels Gitea reports for a team, ordered. Anything at `write` or above
 * on `repo.code` can put a version into a workspace, which is what a seat is.
 */
const ACCESS_ORDER = ["none", "read", "write", "admin", "owner"] as const;

type AccessLevel = (typeof ACCESS_ORDER)[number];

function accessRank(access: string | undefined): number {
  const index = ACCESS_ORDER.indexOf(access as AccessLevel);
  return index === -1 ? 0 : index;
}

/**
 * The unit map each role gets, verified against Gitea 1.26 by
 * `tests/gitea-permission-model.pw.ts`.
 *
 * Reviewers get **read** on both `repo.code` and `repo.pulls` and nothing more.
 * That is the whole cost of reviewing: Gitea's `/pulls` route group is guarded
 * by a code reader plus a pulls reader, the review endpoints add only an auth
 * check on top, and commenting on a change resolves to the same read on
 * `repo.pulls`. A reviewer cannot create a branch, so they cannot start a
 * version, let alone land one.
 *
 * Whether their approval *counts* is a separate matter and is not settled here:
 * it needs `enable_approvals_whitelist` on the workspace's branch protection
 * with these teams whitelisted. See ADR 0004, "Verified Against Gitea".
 */
/**
 * Exported because the dev seed creates the same teams over raw HTTP, and two
 * definitions would drift. They already did: the seed once sent `units`, which
 * Gitea ignores in favour of `units_map`, and the teams came out with
 * permission "none" — members of a binder who could not touch it.
 */
export const ROLE_TEAM_OPTIONS: Record<WorkspaceRole, CreateTeamOption> = {
  admins: {
    name: "",
    permission: "admin",
    includes_all_repositories: false,
    can_create_org_repo: false,
  },
  authors: {
    name: "",
    permission: "write",
    includes_all_repositories: false,
    can_create_org_repo: false,
    units_map: {
      "repo.code": "write",
      "repo.pulls": "write",
      "repo.issues": "write",
      "repo.releases": "write",
    },
  },
  reviewers: {
    name: "",
    permission: "read",
    includes_all_repositories: false,
    can_create_org_repo: false,
    units_map: {
      "repo.code": "read",
      "repo.pulls": "read",
      "repo.issues": "read",
    },
  },
};

const ROLE_TEAM_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  admins: "Workspace owners: full control of this binder and its rules.",
  authors: "Paid seats: push versions, open changes, and merge them.",
  reviewers: "Free: read, comment, approve and reject. Cannot publish.",
};

export interface GiteaOrganization {
  id: number;
  name: string;
  fullName: string;
  description: string;
}

export interface GiteaTeam {
  id: number;
  name: string;
  description: string;
  permission: string;
  /** Effective access on `repo.code`, which is what a seat turns on. */
  codeAccess: string;
  includesAllRepositories: boolean;
}

export interface OrgUserSummary {
  id: number;
  login: string;
  fullName: string;
  email: string;
}

function normalizeOrganization(org: Organization): GiteaOrganization {
  return {
    id: org.id ?? 0,
    name: org.name ?? org.username ?? "",
    fullName: org.full_name ?? "",
    description: org.description ?? "",
  };
}

function normalizeTeam(team: Team): GiteaTeam {
  const permission = team.permission ?? "none";
  // units_map is the precise answer when Gitea sends one; the flat permission
  // is the fallback, and is what an admin team reports.
  const codeAccess = team.units_map?.["repo.code"] ?? permission;

  return {
    id: team.id ?? 0,
    name: team.name ?? "",
    description: team.description ?? "",
    permission,
    codeAccess,
    includesAllRepositories: team.includes_all_repositories ?? false,
  };
}

function normalizeOrgUser(
  user: Partial<User> | null | undefined,
): OrgUserSummary {
  return {
    id: user?.id ?? 0,
    login: user?.login ?? "",
    fullName: user?.full_name ?? "",
    email: user?.email ?? "",
  };
}

/** The team name for one role of one workspace: `<workspace>-<role>`. */
export function workspaceTeamName(
  workspace: string,
  role: WorkspaceRole,
): string {
  return `${workspace}-${role}`;
}

export interface CreateOrganizationParams {
  client: GiteaClient;
  /** The org's Gitea username. Also its URL segment. */
  name: string;
  fullName?: string;
  description?: string;
}

/**
 * Create the organization. The caller's token decides who owns it: Gitea makes
 * the creating user the first member of the Owners team, which is exactly the
 * signup behaviour ADR 0004 asks for.
 *
 * Orgs are private: a policy manual is not public by accident.
 */
export async function createOrganization(
  params: CreateOrganizationParams,
): Promise<GiteaOrganization> {
  const { client, name, fullName, description } = params;

  const org = await unwrap(
    client.POST("/orgs", {
      body: {
        username: name,
        full_name: fullName,
        description,
        visibility: "private",
        repo_admin_change_team_access: false,
      } satisfies CreateOrgOption,
    }),
  );

  return normalizeOrganization(org);
}

export interface OrganizationParams {
  client: GiteaClient;
  org: string;
}

export async function getOrganization(
  params: OrganizationParams,
): Promise<GiteaOrganization> {
  const { client, org } = params;

  const result = await unwrap(
    client.GET("/orgs/{org}", { params: { path: { org } } }),
  );

  return normalizeOrganization(result);
}

/** The organization, or null when it does not exist. */
export async function findOrganization(
  params: OrganizationParams,
): Promise<GiteaOrganization | null> {
  try {
    return await getOrganization(params);
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function listOrganizationTeams(
  params: OrganizationParams,
): Promise<GiteaTeam[]> {
  const { client, org } = params;

  const teams = await unwrap(
    client.GET("/orgs/{org}/teams", {
      params: { path: { org }, query: { limit: 100 } },
    }),
  );

  return (teams ?? []).map(normalizeTeam);
}

export interface FindOrganizationTeamParams extends OrganizationParams {
  name: string;
}

export async function findOrganizationTeam(
  params: FindOrganizationTeamParams,
): Promise<GiteaTeam | null> {
  const teams = await listOrganizationTeams(params);
  return teams.find((team) => team.name === params.name) ?? null;
}

export interface CreateWorkspaceRoleTeamParams extends OrganizationParams {
  /** The workspace repository the team is named for. */
  workspace: string;
  role: WorkspaceRole;
}

/**
 * Create one role team. Idempotent: an existing team of the same name is
 * returned rather than re-created, so provisioning can be re-run after a
 * partial failure without hand-cleaning the org.
 */
export async function createWorkspaceRoleTeam(
  params: CreateWorkspaceRoleTeamParams,
): Promise<GiteaTeam> {
  const { client, org, workspace, role } = params;
  const name = workspaceTeamName(workspace, role);

  const existing = await findOrganizationTeam({ client, org, name });
  if (existing) {
    return existing;
  }

  const team = await unwrap(
    client.POST("/orgs/{org}/teams", {
      params: { path: { org } },
      body: {
        ...ROLE_TEAM_OPTIONS[role],
        name,
        description: ROLE_TEAM_DESCRIPTIONS[role],
      } satisfies CreateTeamOption,
    }),
  );

  return normalizeTeam(team);
}

export interface CreateWorkspaceTeamsParams extends OrganizationParams {
  workspace: string;
}

/** All three role teams for a workspace, created in a fixed order. */
export async function createWorkspaceTeams(
  params: CreateWorkspaceTeamsParams,
): Promise<Record<WorkspaceRole, GiteaTeam>> {
  const teams = {} as Record<WorkspaceRole, GiteaTeam>;

  for (const role of WORKSPACE_ROLES) {
    teams[role] = await createWorkspaceRoleTeam({ ...params, role });
  }

  return teams;
}

export interface TeamRepoParams {
  client: GiteaClient;
  teamId: number;
  org: string;
  repo: string;
}

/** Grant a team onto a repository — how a role becomes access to a binder. */
export async function grantTeamOnRepo(params: TeamRepoParams): Promise<void> {
  const { client, teamId, org, repo } = params;

  const { error, response } = await client.PUT(
    "/teams/{id}/repos/{org}/{repo}",
    {
      params: { path: { id: teamId, org, repo } },
    },
  );

  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}

export async function revokeTeamFromRepo(
  params: TeamRepoParams,
): Promise<void> {
  const { client, teamId, org, repo } = params;

  const { error, response } = await client.DELETE(
    "/teams/{id}/repos/{org}/{repo}",
    { params: { path: { id: teamId, org, repo } } },
  );

  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}

export interface TeamMemberParams {
  client: GiteaClient;
  teamId: number;
  username: string;
}

/**
 * Add someone to a team. This is also how they join the organization: Gitea
 * makes team membership imply org membership, so there is no separate invite
 * step and no second list to keep in sync.
 */
export async function addTeamMember(params: TeamMemberParams): Promise<void> {
  const { client, teamId, username } = params;

  const { error, response } = await client.PUT(
    "/teams/{id}/members/{username}",
    {
      params: { path: { id: teamId, username } },
    },
  );

  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}

export async function removeTeamMember(
  params: TeamMemberParams,
): Promise<void> {
  const { client, teamId, username } = params;

  const { error, response } = await client.DELETE(
    "/teams/{id}/members/{username}",
    { params: { path: { id: teamId, username } } },
  );

  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}

export interface ListTeamMembersParams {
  client: GiteaClient;
  teamId: number;
}

export async function listTeamMembers(
  params: ListTeamMembersParams,
): Promise<OrgUserSummary[]> {
  const { client, teamId } = params;

  const members = await unwrap(
    client.GET("/teams/{id}/members", {
      params: { path: { id: teamId }, query: { limit: 100 } },
    }),
  );

  return (members ?? []).map(normalizeOrgUser);
}

/**
 * Who can change billing, per ADR 0004: the Owners team, read from Gitea
 * rather than an app-side role table.
 */
export async function listOrganizationOwners(
  params: OrganizationParams,
): Promise<OrgUserSummary[]> {
  const owners = await findOrganizationTeam({
    ...params,
    name: OWNERS_TEAM_NAME,
  });

  if (!owners) {
    return [];
  }

  return listTeamMembers({ client: params.client, teamId: owners.id });
}

export interface IsOrganizationOwnerParams extends OrganizationParams {
  username: string;
}

export async function isOrganizationOwner(
  params: IsOrganizationOwnerParams,
): Promise<boolean> {
  const owners = await listOrganizationOwners(params);
  return owners.some(
    (owner) => owner.login.toLowerCase() === params.username.toLowerCase(),
  );
}

/**
 * The teams that confer write access to a binder, and therefore cost a seat.
 *
 * ADR 0004 defines a billable seat as "a distinct human with write access to
 * any workspace in the org", then names the `-admins` and `-authors` teams as
 * where that lives. Those names are not the criterion here — the permission is.
 * Matching on a suffix would miss the Owners team, whose members have write
 * access to every repository in the org, and an org can move everyone into
 * Owners for free. Reading the permission instead cannot be gamed and cannot
 * drift, which is the whole reason the count is derived rather than stored.
 *
 * A team that grants write but holds no repository grants access to nothing, so
 * it is not counted.
 */
async function listSeatBearingTeams(
  params: OrganizationParams,
): Promise<GiteaTeam[]> {
  const teams = await listOrganizationTeams(params);
  const writers = teams.filter(
    (team) => accessRank(team.codeAccess) >= accessRank("write"),
  );

  const bearing: GiteaTeam[] = [];
  for (const team of writers) {
    if (team.includesAllRepositories) {
      bearing.push(team);
      continue;
    }
    if (await teamHoldsAnyRepo(params.client, team.id)) {
      bearing.push(team);
    }
  }

  return bearing;
}

async function teamHoldsAnyRepo(
  client: GiteaClient,
  teamId: number,
): Promise<boolean> {
  const repos = await unwrap(
    client.GET("/teams/{id}/repos", {
      params: { path: { id: teamId }, query: { limit: 1 } },
    }),
  );

  return (repos ?? []).length > 0;
}

/**
 * Every human the organization is billed for, counted once however many binders
 * they author in. Derived from Gitea on every call — there is no seat table to
 * drift, so the nightly reconcile is a recompute rather than a repair.
 *
 * Reviewers never appear here: read on `repo.code` does not clear the bar.
 */
export async function listBillableSeats(
  params: OrganizationParams,
): Promise<OrgUserSummary[]> {
  const teams = await listSeatBearingTeams(params);

  const byLogin = new Map<string, OrgUserSummary>();
  for (const team of teams) {
    const members = await listTeamMembers({
      client: params.client,
      teamId: team.id,
    });
    for (const member of members) {
      // Highest right wins, and one human is one seat: keyed on the login, so
      // being in three teams across three binders still costs one.
      byLogin.set(member.login.toLowerCase(), member);
    }
  }

  return [...byLogin.values()].sort((a, b) => a.login.localeCompare(b.login));
}

export async function countBillableSeats(
  params: OrganizationParams,
): Promise<number> {
  return (await listBillableSeats(params)).length;
}
