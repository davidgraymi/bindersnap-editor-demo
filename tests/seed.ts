/**
 * Applies the declarative seed scenario to a running Gitea.
 *
 * There is no seed data in this file. What gets created lives in
 * `tests/seed-data/dev.yaml`; this module is the engine that turns that
 * description into Gitea repos, branches, pull requests, reviews, review
 * threads, merges, and version tags — in that order, idempotently, so
 * re-running it against a warm stack changes nothing.
 *
 * Adding a document or a reviewer is a YAML edit. Only a change to *how*
 * Bindersnap models something in Gitea should ever bring you here.
 */

import { pathToFileURL } from "node:url";

import {
  CODEOWNERS_PATH,
  renderCodeowners,
  type SignOffRule,
} from "../packages/utils/codeowners";
import { formatDocumentName } from "../packages/utils/documentTitle";
import {
  ROLE_TEAM_DESCRIPTIONS,
  ROLE_TEAM_OPTIONS,
  STAFF_TEAM_NAME,
} from "../services/api/gitea-client/orgs";
import {
  buildVersionStamp,
  buildArchiveStamp,
} from "../services/api/version-stamp";
import { renderSeedDocumentFile } from "./seed-documents";
import {
  binderDocumentSlugPath,
  loadSeedScenario,
  canonicalFileNameFor,
  seedDocumentUid,
  type SeedAct,
  type SeedAssignment,
  type SeedBinderChange,
  type SeedChange,
  type SeedBinder,
  type SeedBinderDocument,
  type SeedDocumentFormat,
  type SeedGroup,
  type SeedOrganization,
  type SeedScenario,
  type SeedSignOffRule,
  type SeedThread,
  type SeedUser,
} from "./seed-scenario";

const DEFAULT_GITEA_URL = `http://localhost:${process.env.GITEA_PORT ?? "3000"}`;
const SCENARIO_URL = new URL("seed-data/dev.yaml", import.meta.url);

/** Kept for callers that still ask for the two historically-seeded PRs. */
const PRIMARY_CHANGE = "alice/quarterly-report#feature/q2-amendments";
const SECONDARY_CHANGE = "alice/vendor-contracts#feature/acme-renewal";

type BasicAuth = {
  username: string;
  password: string;
};

type SeedOptions = {
  baseUrl?: string;
  adminUser?: string;
  /**
   * Password for every seeded account, not just the admin. The accounts share
   * one password by design — see `password` in the scenario file.
   */
  adminPass?: string;
  createToken?: boolean;
  tokenNamePrefix?: string;
  /** Override the scenario file. Defaults to `tests/seed-data/dev.yaml`. */
  scenario?: SeedScenario;
  log?: (message: string) => void;
};

type SeedResult = {
  token?: string;
  tokenName?: string;
  /** Pull request numbers keyed by `owner/repo#branch`. */
  pullRequests: Record<string, number>;
  /** The `alice/quarterly-report` review PR. */
  prNumber: number;
  /** The `alice/vendor-contracts` review PR. */
  secondPrNumber: number;
  oauthClientId?: string;
};

type GiteaContentFile = {
  sha: string;
  content?: string;
};

type GiteaPull = {
  number: number;
  title: string;
  /** The first line is the name every screen shows — see `changeBody`. */
  body?: string;
  state?: string;
  merged?: boolean;
  head?: { ref?: string };
};

type GiteaReview = {
  state?: string;
  body?: string;
  user?: { login?: string };
  stale?: boolean;
  dismissed?: boolean;
};

type GiteaComment = {
  id: number;
  body?: string;
  user?: { login?: string };
};

type GiteaToken = {
  sha1?: string;
};

type GiteaOAuthApp = {
  id: number;
  name: string;
  client_id: string;
};

type GiteaBranchProtection = {
  rule_name?: string;
};

type RequestOptions = {
  method?: string;
  auth?: BasicAuth;
  headers?: HeadersInit;
  body?: string;
  expectedStatuses?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeAuth(auth: BasicAuth): string {
  return Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
}

function repoPath(owner: string, repo: string): string {
  return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function giteaRequest(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    auth,
    headers,
    body,
    expectedStatuses = [200],
  } = options;

  const nextHeaders = new Headers(headers);
  if (auth) {
    nextHeaders.set("Authorization", `Basic ${encodeAuth(auth)}`);
  }
  if (body && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: nextHeaders,
    body,
  });

  if (!expectedStatuses.includes(response.status)) {
    const responseBody = await response.text();
    throw new Error(
      `Request failed ${method} ${path}: ${response.status} ${responseBody}`,
    );
  }

  return response;
}

async function giteaJson<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await giteaRequest(baseUrl, path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function waitForUrl(
  baseUrl: string,
  path: string,
  attempts: number,
  delayMs: number,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(new URL(path, baseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient connection errors while service boots.
    }
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${new URL(path, baseUrl).toString()}`);
}

/** The port Gitea serves HTTP on, read off the base URL the seeder was given. */
function resolveGiteaHttpPort(baseUrl: string): string {
  try {
    const port = new URL(baseUrl).port;
    if (port) return port;
  } catch {
    // Fall through to the default below.
  }
  return "3000";
}

async function maybeBootstrapInstall(
  baseUrl: string,
  adminUser: string,
  adminPass: string,
  adminEmail: string,
  log: (message: string) => void,
): Promise<void> {
  const adminLookup = await giteaRequest(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(adminUser)}`,
    {
      expectedStatuses: [200, 404],
    },
  );
  if (adminLookup.status === 200) {
    return;
  }

  log("Bootstrapping Gitea install and admin user...");
  // The install form has to advertise the port Gitea actually listens on,
  // which is whatever GITEA_URL points at — not a hardcoded 3000.
  const giteaHttpPort = resolveGiteaHttpPort(baseUrl);
  const form = new URLSearchParams({
    db_type: "sqlite3",
    db_path: "/data/gitea.db",
    app_name: "Gitea",
    repo_root_path: "/data/git/repositories",
    run_user: "git",
    domain: "localhost",
    ssh_port: "22",
    http_port: giteaHttpPort,
    app_url: `http://localhost:${giteaHttpPort}/`,
    log_root_path: "/data/gitea/log",
    admin_name: adminUser,
    admin_passwd: adminPass,
    admin_confirm_passwd: adminPass,
    admin_email: adminEmail,
  });

  await giteaRequest(baseUrl, "/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    expectedStatuses: [200, 302, 303, 405],
  });
}

/**
 * Create the account, or bring an existing one back in line with the scenario.
 *
 * The password reset matters: changing `password:` in the YAML has to work
 * against a stack whose Gitea volume already holds the old accounts, otherwise
 * every password change would mean `bun run down -v` first.
 */
async function ensureUser(
  baseUrl: string,
  adminAuth: BasicAuth,
  username: string,
  password: string,
  email: string,
  fullName: string,
  /**
   * Whether this account runs Bindersnap itself.
   *
   * Sent on both paths, and sent as `false` as well as `true`: turning the flag
   * off in the YAML has to demote the account on the next run, or the seed can
   * only ever add powers to a warm stack.
   */
  siteAdmin: boolean,
  log: (message: string) => void,
): Promise<void> {
  const created = await giteaRequest(baseUrl, "/api/v1/admin/users", {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify({
      login_name: username,
      username,
      email,
      password,
      full_name: fullName,
      must_change_password: false,
      send_notify: false,
      admin: siteAdmin,
    }),
    expectedStatuses: [201, 422],
  });

  if (created.status === 201) {
    log(`Created user: ${username}${siteAdmin ? " (site admin)" : ""}`);
    return;
  }

  await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(username)}`,
    {
      method: "PATCH",
      auth: adminAuth,
      body: JSON.stringify({
        login_name: username,
        email,
        password,
        full_name: fullName,
        must_change_password: false,
        admin: siteAdmin,
      }),
      expectedStatuses: [200, 403, 422],
    },
  );
  log(`User already exists, refreshed: ${username}`);
}

/** The install admin's name and email, which the install form never asked for. */
async function refreshAdminProfile(
  baseUrl: string,
  adminAuth: BasicAuth,
  user: SeedUser | undefined,
  log: (message: string) => void,
): Promise<void> {
  if (!user) return;

  await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(user.username)}`,
    {
      method: "PATCH",
      auth: adminAuth,
      body: JSON.stringify({
        login_name: user.username,
        email: user.email,
        full_name: user.fullName,
      }),
      expectedStatuses: [200, 403, 422],
    },
  );
  log(`Refreshed the administrator's profile: ${user.username}`);
}

/**
 * The organization that owns every binder.
 *
 * ADR 0004's first level. It is created by its owner's account rather than by
 * the admin, because Gitea puts the creating user in the Owners team — and the
 * person who owns the organization is the one who can change its billing.
 */
async function ensureOrganization(
  baseUrl: string,
  adminAuth: BasicAuth,
  scenario: SeedScenario,
  log: (message: string) => void,
): Promise<void> {
  const { name, displayName, owner } = scenario.organization;

  const response = await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(owner)}/orgs`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        username: name,
        full_name: displayName,
        visibility: "private",
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    response.status === 201
      ? `Created organization: ${name}`
      : `Organization already exists: ${name}`,
  );

  // Almost everybody in the scenario is a member of the one organization — ADR
  // 0004 is explicit that a second binder should cost no new membership list.
  // The exception is deliberate: an account that belongs to no organization is
  // a state the product has to have an answer for, and the only way to look at
  // that answer is to have one to sign in as.
  for (const user of scenario.users) {
    if (user.username === owner) continue;
    if (!user.organizationMember) {
      log(`Left outside the organization: ${user.username}`);
      continue;
    }
    await giteaRequest(
      baseUrl,
      `/api/v1/orgs/${encodeURIComponent(name)}/members/${encodeURIComponent(user.username)}`,
      {
        method: "PUT",
        auth: adminAuth,
        expectedStatuses: [204, 403, 404, 405],
      },
    );
  }

  // The Owners team, which Gitea made and put the creating account in. An
  // organization owner who is not also the site administrator is the persona
  // most of the billing and people screens are written for, and the seed had
  // no way to produce one.
  if (scenario.organization.owners.length > 0) {
    const owners = await findTeam(baseUrl, adminAuth, name, "Owners");
    if (owners) {
      for (const extra of scenario.organization.owners) {
        await giteaRequest(
          baseUrl,
          `/api/v1/teams/${owners.id}/members/${encodeURIComponent(extra)}`,
          { method: "PUT", auth: adminAuth, expectedStatuses: [204, 404, 405] },
        );
        log(`Added organization owner: ${extra}`);
      }
    }
  }
}

/**
 * Make a team hold exactly these people — **removals included**.
 *
 * Adding alone is not reconciling, and the difference shows the first time
 * somebody's role changes in the YAML: moving an account from authors to
 * admins left it in both teams on every warm stack, and the only way back was
 * `up --fresh`. A seed whose job is to make the stack match the file has to be
 * able to take something away.
 */
async function reconcileTeamMembers(
  baseUrl: string,
  adminAuth: BasicAuth,
  teamId: number,
  wanted: readonly string[],
  log: (message: string) => void,
): Promise<void> {
  const current = await giteaJson<Array<{ login?: string }>>(
    baseUrl,
    `/api/v1/teams/${teamId}/members?limit=100`,
    { auth: adminAuth, expectedStatuses: [200] },
  ).catch(() => []);

  const have = new Set(
    current
      .map((member) => member.login)
      .filter((login) => login !== undefined),
  );

  for (const member of wanted) {
    if (have.has(member)) continue;
    await giteaRequest(
      baseUrl,
      `/api/v1/teams/${teamId}/members/${encodeURIComponent(member)}`,
      { method: "PUT", auth: adminAuth, expectedStatuses: [204, 404, 405] },
    );
  }

  for (const member of have) {
    if (wanted.includes(member)) continue;
    await giteaRequest(
      baseUrl,
      `/api/v1/teams/${teamId}/members/${encodeURIComponent(member)}`,
      { method: "DELETE", auth: adminAuth, expectedStatuses: [204, 404, 405] },
    );
    log(
      `Removed ${member} from team ${teamId} — the scenario no longer has them there`,
    );
  }
}

/** One of the organization's teams, by name, or null if it has none. */
async function findTeam(
  baseUrl: string,
  adminAuth: BasicAuth,
  org: string,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const teams = await giteaJson<Array<{ id: number; name: string }>>(
    baseUrl,
    `/api/v1/orgs/${encodeURIComponent(org)}/teams?limit=100`,
    { auth: adminAuth },
  );
  return teams.find((team) => team.name === name) ?? null;
}

/**
 * The customer's own groups: a Quality Committee, a Legal team.
 *
 * Distinct from a binder's three role teams, which the binder makes for itself.
 * These are made once and granted onto as many binders as the customer likes —
 * which is the entire argument for the level, and is also what a sign-off rule
 * needs, since a rule names a team rather than a list of people.
 *
 * A group is a Gitea team carrying one of the role unit maps, so the level
 * travels with the name. Reused rather than restated: a second definition of
 * what "editor" means is how the seed's binder teams once came out with
 * permission "none".
 */
async function ensureOrganizationGroups(
  baseUrl: string,
  adminAuth: BasicAuth,
  org: string,
  groups: SeedGroup[],
  log: (message: string) => void,
): Promise<void> {
  if (groups.length === 0) return;

  const existing = await giteaJson<Array<{ id: number; name: string }>>(
    baseUrl,
    `/api/v1/orgs/${encodeURIComponent(org)}/teams?limit=100`,
    { auth: adminAuth },
  );

  const roleFor = {
    admin: "admins",
    editor: "authors",
    reviewer: "reviewers",
  } as const;

  for (const group of groups) {
    const options = {
      ...ROLE_TEAM_OPTIONS[roleFor[group.level]],
      name: group.name,
      description: group.description,
    };

    let team = existing.find((candidate) => candidate.name === group.name);

    if (team) {
      await giteaRequest(baseUrl, `/api/v1/teams/${team.id}`, {
        method: "PATCH",
        auth: adminAuth,
        body: JSON.stringify(options),
        expectedStatuses: [200, 404],
      });
    } else {
      const created = await giteaRequest(
        baseUrl,
        `/api/v1/orgs/${encodeURIComponent(org)}/teams`,
        {
          method: "POST",
          auth: adminAuth,
          body: JSON.stringify(options),
          expectedStatuses: [201, 422],
        },
      );
      team = (await created.json()) as { id: number; name: string };
      existing.push(team);
    }

    await reconcileTeamMembers(baseUrl, adminAuth, team.id, group.members, log);

    log(`Ensured group: ${org}/${group.name} (${group.level})`);
  }
}

/**
 * The organization's `staff` team, which is the "open to the organization"
 * switch rather than Gitea's repository visibility.
 *
 * Made here rather than assumed, because the seed creates its organization
 * over raw HTTP and never goes through the provisioning path that would
 * otherwise have made it.
 */
async function ensureStaffTeamId(
  baseUrl: string,
  adminAuth: BasicAuth,
  org: string,
  log: (message: string) => void,
): Promise<number | null> {
  const existing = await findTeam(baseUrl, adminAuth, org, STAFF_TEAM_NAME);
  if (existing) return existing.id;

  const created = await giteaRequest(
    baseUrl,
    `/api/v1/orgs/${encodeURIComponent(org)}/teams`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        name: STAFF_TEAM_NAME,
        description:
          "Everyone at this organization. Granted onto a binder to let the whole staff read it.",
        permission: "read",
        includes_all_repositories: false,
        can_create_org_repo: false,
        units_map: {
          "repo.code": "read",
          "repo.pulls": "read",
          "repo.issues": "read",
        },
      }),
      expectedStatuses: [201, 422],
    },
  );

  if (created.status !== 201) return null;
  const team = (await created.json()) as { id: number };
  log(`Created the ${STAFF_TEAM_NAME} team for ${org}`);
  return team.id;
}

/** Everyone in the organization is in `staff`. That is what the team is. */
async function ensureStaffMembers(
  baseUrl: string,
  adminAuth: BasicAuth,
  teamId: number,
  scenario: SeedScenario,
): Promise<void> {
  for (const user of scenario.users) {
    if (!user.organizationMember) continue;
    await giteaRequest(
      baseUrl,
      `/api/v1/teams/${teamId}/members/${encodeURIComponent(user.username)}`,
      { method: "PUT", auth: adminAuth, expectedStatuses: [204, 404, 405] },
    );
  }
}

/** The binder: one repository, owned by the organization rather than a person. */
async function ensureOrgRepo(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  description: string,
  log: (message: string) => void,
): Promise<void> {
  const response = await giteaRequest(
    baseUrl,
    `/api/v1/orgs/${encodeURIComponent(owner)}/repos`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        name: repo,
        description,
        private: true,
        auto_init: true,
        default_branch: "main",
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    response.status === 201
      ? `Created binder: ${owner}/${repo}`
      : `Binder already exists: ${owner}/${repo}`,
  );
}

/**
 * The binder's three role teams, and who is in them.
 *
 * Membership is the binder's, not a document's. A compliance officer joining
 * 200 policies used to be 200 calls; here it is one, which is the argument the
 * whole level rests on.
 */
async function ensureBinderTeams(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  binder: SeedBinder,
  log: (message: string) => void,
): Promise<void> {
  const existing = (await giteaRequest(
    baseUrl,
    `/api/v1/orgs/${encodeURIComponent(owner)}/teams`,
    { auth: adminAuth, expectedStatuses: [200] },
  ).then((response) => response.json())) as Array<{
    id: number;
    name: string;
  }>;

  for (const role of ["admins", "authors", "reviewers"] as const) {
    const teamName = `${repo}-${role}`;
    let team = existing.find((candidate) => candidate.name === teamName);

    // The app's own definition, not a copy of it. `units_map` is what Gitea
    // actually reads — a bare `permission` alongside `units` silently produces
    // a team with no access at all.
    const options = {
      ...ROLE_TEAM_OPTIONS[role],
      name: teamName,
      description: ROLE_TEAM_DESCRIPTIONS[role],
    };

    if (team) {
      // Repair rather than skip: a team created by an older seed may carry the
      // wrong permission, and re-seeding is supposed to fix the stack, not
      // preserve its mistakes.
      await giteaRequest(baseUrl, `/api/v1/teams/${team.id}`, {
        method: "PATCH",
        auth: adminAuth,
        body: JSON.stringify(options),
        expectedStatuses: [200, 404],
      });
    } else {
      const created = await giteaRequest(
        baseUrl,
        `/api/v1/orgs/${encodeURIComponent(owner)}/teams`,
        {
          method: "POST",
          auth: adminAuth,
          body: JSON.stringify(options),
          expectedStatuses: [201, 422],
        },
      );
      team = (await created.json()) as { id: number; name: string };
      existing.push(team);
    }

    await giteaRequest(
      baseUrl,
      `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { method: "PUT", auth: adminAuth, expectedStatuses: [204, 404, 405] },
    );

    await reconcileTeamMembers(
      baseUrl,
      adminAuth,
      team.id,
      binder.members
        .filter((candidate) => candidate.role === role)
        .map((member) => member.user),
      log,
    );
  }

  // Whatever is granted here has to be on the approvals whitelist, or its
  // members' approvals are recorded, displayed, and count nothing — and the
  // seed's own publishes would fail with "does not have enough approvals"
  // beside a green tick. Provisioning whitelists `staff` and `Owners`; these
  // role teams are the seed's own addition, so it names them itself.
  //
  // `Owners` is on the list although it is never granted onto a repository:
  // Gitea gives it admin over the organization implicitly, so a list derived
  // from the granted teams alone would silently stop counting an owner.
  const granted = (await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/teams`,
    { auth: adminAuth, expectedStatuses: [200] },
  ).then((response) => response.json())) as Array<{ name: string }>;

  await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/branch_protections/main`,
    {
      method: "PATCH",
      auth: adminAuth,
      body: JSON.stringify({
        enable_approvals_whitelist: true,
        approvals_whitelist_teams: [
          ...new Set([...granted.map((team) => team.name), "Owners"]),
        ],
      }),
      expectedStatuses: [200, 404],
    },
  );

  log(`Ensured binder teams: ${owner}/${repo}`);
}

/**
 * Strip `main` back to an empty history.
 *
 * A Bindersnap document only reaches `main` by being published, so a freshly
 * created repository must not carry Gitea's auto-init README or a stray
 * document file — otherwise every new document would look already-published.
 */
async function bootstrapEmptyMainBranch(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  log: (message: string) => void,
): Promise<void> {
  const currentFile = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/contents/README.md?ref=main`,
    {
      auth: adminAuth,
      expectedStatuses: [200, 404],
    },
  );

  if (currentFile.status === 404) {
    log(`Main branch already bootstrapped: ${owner}/${repo}`);
    return;
  }

  const filePayload = (await currentFile.json()) as GiteaContentFile;
  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/README.md`, {
    method: "DELETE",
    auth: adminAuth,
    body: JSON.stringify({
      branch: "main",
      message: "seed: remove README.md from main",
      sha: filePayload.sha,
    }),
    expectedStatuses: [200],
  });
  log(`Bootstrapped empty main branch: ${owner}/${repo}`);
}

/**
 * Protect `main`, and **keep it protected the way it is meant to be**.
 *
 * This used to return early when a rule already existed, which is the wrong
 * shape for a seed that runs again on every `bun run up`. `block_on_codeowner_
 * reviews` was added to this body after stacks already had a `main` rule
 * without it, and those stacks never picked it up: the flag stayed off, Gitea
 * held no merge for `.gitea/CODEOWNERS`, and the binder's Sign-off rules tab
 * warned — correctly — that nothing there was being enforced. Only
 * `up --fresh` cleared it.
 *
 * So it reconciles instead. `PATCH` writes the same body onto an existing rule,
 * which makes this idempotent in the way the rest of the seed already is: the
 * settings below are what ends up on the branch whether this is the first run
 * or the fourth. The app's own `protectWorkspaceMain` reached that conclusion
 * first and is worth reading beside this.
 *
 * Note this is still a *second* copy of the binder's protection — the app's is
 * the other — and copies of one rule are what this codebase keeps catching
 * mid-drift. It stays separate only because the seed talks to Gitea directly
 * with no app running.
 */
async function ensureMainBranchProtection(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  requiredApprovals: number,
  log: (message: string) => void,
): Promise<void> {
  const body = {
    rule_name: "main",
    required_approvals: requiredApprovals,
    enable_approvals_whitelist: false,
    enable_merge_whitelist: false,
    block_on_rejected_reviews: true,
    // Gitea 28.0.0's per-folder gate, which the dev stack's pinned nightly has
    // and 1.27.3 silently drops. Set here so a seeded binder demonstrates the
    // feature rather than opening its Sign-off rules tab with a warning that
    // nothing is being enforced.
    block_on_codeowner_reviews: true,
    block_on_outdated_branch: true,
    dismiss_stale_approvals: true,
    enable_force_push: false,
    enable_push: false,
  };

  const protections = await giteaJson<GiteaBranchProtection[]>(
    baseUrl,
    `${repoPath(owner, repo)}/branch_protections`,
    { auth: adminAuth },
  );

  if (protections.some((protection) => protection.rule_name === "main")) {
    await giteaRequest(
      baseUrl,
      `${repoPath(owner, repo)}/branch_protections/main`,
      {
        method: "PATCH",
        auth: adminAuth,
        body: JSON.stringify(body),
        expectedStatuses: [200],
      },
    );
    log(`Reconciled main branch protection: ${owner}/${repo}`);
    return;
  }

  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/branch_protections`, {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify(body),
    expectedStatuses: [201],
  });

  log(`Ensured main branch protection: ${owner}/${repo}`);
}

/**
 * Commit a file, or leave it alone when it already says the same thing.
 *
 * The content arrives base64-encoded rather than as text because a seeded
 * document is not always text — the policy manual carries a Word file and a
 * PDF as well — and base64 is what the contents API takes either way.
 */
async function ensureFile(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  path: string,
  contentBase64: string,
  commitMessage: string,
  branch: string,
  log?: (message: string) => void,
): Promise<void> {
  const getPath = `${repoPath(owner, repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const currentFile = await giteaRequest(baseUrl, getPath, {
    auth,
    expectedStatuses: [200, 404],
  });

  if (currentFile.status === 404) {
    await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/${path}`, {
      method: "POST",
      auth,
      body: JSON.stringify({
        message: commitMessage,
        content: contentBase64,
        branch,
      }),
      expectedStatuses: [201],
    });
    log?.(`Committed: ${owner}/${repo}@${branch} ${path}`);
    return;
  }

  const filePayload = (await currentFile.json()) as GiteaContentFile;
  // Gitea wraps its base64 at column 60; the seed's is one long line.
  if ((filePayload.content ?? "").replace(/\s+/g, "") === contentBase64) {
    log?.(`Already up to date: ${owner}/${repo}@${branch} ${path}`);
    return;
  }

  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/${path}`, {
    method: "PUT",
    auth,
    body: JSON.stringify({
      message: commitMessage,
      content: contentBase64,
      sha: filePayload.sha,
      branch,
    }),
    expectedStatuses: [200],
  });
  log?.(`Updated: ${owner}/${repo}@${branch} ${path}`);
}

async function ensureCollaborator(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  collaborator: string,
  permission: string,
  log: (message: string) => void,
): Promise<void> {
  await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/collaborators/${encodeURIComponent(collaborator)}`,
    {
      method: "PUT",
      auth: adminAuth,
      body: JSON.stringify({ permission }),
      expectedStatuses: [204],
    },
  );
  log(`Ensured collaborator: ${collaborator} (${permission}) on ${repo}`);
}

/**
 * The branch, and **whether this run is the one that made it**.
 *
 * The answer matters to a change whose commit is a list of moves and deletes:
 * replaying those onto a branch that already has them applied is not a no-op,
 * it is a rename of a file that is no longer there. Only the run that creates
 * the branch commits to it.
 */
async function ensureBranch(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  sourceRef: string,
  log: (message: string) => void,
): Promise<boolean> {
  const getResponse = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/branches/${encodeURIComponent(branchName)}`,
    {
      auth,
      expectedStatuses: [200, 404],
    },
  );

  if (getResponse.status === 200) {
    log(`Branch already exists: ${branchName}`);
    return false;
  }

  const createResponse = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/branches`,
    {
      method: "POST",
      auth,
      body: JSON.stringify({
        new_branch_name: branchName,
        old_ref_name: sourceRef,
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    createResponse.status === 201
      ? `Created branch: ${branchName}`
      : `Branch already exists: ${branchName}`,
  );
  return createResponse.status === 201;
}

async function findPullRequest(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
): Promise<GiteaPull | undefined> {
  const pulls = await giteaJson<GiteaPull[]>(
    baseUrl,
    `${repoPath(owner, repo)}/pulls?state=all&limit=100`,
    { auth },
  );
  return pulls.find((pull) => pull.head?.ref === branchName);
}

async function ensurePullRequest(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string,
  log: (message: string) => void,
): Promise<GiteaPull> {
  const existing = await findPullRequest(
    baseUrl,
    auth,
    owner,
    repo,
    branchName,
  );
  if (existing) {
    // The body as well as the title, because the body is where the name every
    // screen shows actually lives. Reconciling only the title left a warm
    // stack listing changes under a body written by an older seed.
    const wanted = changeBody(title, body);
    if (existing.title !== title || (existing.body ?? "") !== wanted) {
      await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/issues/${existing.number}`,
        {
          // Gitea answers this one 201, not 200 — it is the issue *edit*
          // endpoint and it reports a create. Expecting only 200 turned an
          // ordinary reconcile into an aborted seed halfway through the first
          // binder.
          method: "PATCH",
          auth,
          body: JSON.stringify({ title, body: wanted }),
          expectedStatuses: [200, 201],
        },
      );
      log(`Updated pull request: #${existing.number} ${title}`);
    } else {
      log(`Pull request already exists: #${existing.number}`);
    }
    return { ...existing, title, body: wanted };
  }

  const created = await giteaJson<GiteaPull>(
    baseUrl,
    `${repoPath(owner, repo)}/pulls`,
    {
      method: "POST",
      auth,
      body: JSON.stringify({
        base: "main",
        head: branchName,
        title,
        body: changeBody(title, body),
      }),
      expectedStatuses: [201],
    },
  );

  log(`Created pull request: #${created.number} ${title}`);
  return created;
}

/**
 * The change's body, written the way the app writes one.
 *
 * **The first line is the name every screen shows** — `parseChangeTitle` takes
 * it, and `describeSubmission` takes the rest as the description underneath.
 * Gitea's own `title` field is not what the app reads, which is easy to miss
 * and was: the seed sent the summary alone as the body, so every seeded change
 * was listed under its summary and its title appeared nowhere. It went
 * unnoticed while the summaries happened to read like titles, and stopped
 * being invisible the moment one of them was a sentence about the change
 * rather than a name for it.
 */
function changeBody(title: string, summary: string): string {
  const detail = summary.trim();
  if (detail === "" || detail === title.trim()) return title;
  return `${title}\n\n${detail}`;
}

const REVIEW_EVENTS: Record<string, string> = {
  approved: "APPROVED",
  changes_requested: "REQUEST_CHANGES",
  commented: "COMMENT",
};

const REVIEW_STATES: Record<string, string[]> = {
  approved: ["APPROVED"],
  changes_requested: ["REQUEST_CHANGES", "CHANGES_REQUESTED"],
  commented: ["COMMENT", "COMMENTED"],
};

/**
 * Bring the pull request's reviews in line with the scenario.
 *
 * Retries, because Gitea dismisses approvals asynchronously when it catches up
 * with the push that created the branch — a push that lands moments before the
 * pull request exists. Without the retry a seeded approval silently arrives
 * dismissed, and the document shows up in the wrong state.
 */
async function ensureReviews(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  owner: string,
  repo: string,
  pullNumber: number,
  wanted: SeedChange["reviews"],
  log: (message: string) => void,
): Promise<void> {
  if (wanted.length === 0) {
    return;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reviews = await giteaJson<GiteaReview[]>(
      baseUrl,
      `${repoPath(owner, repo)}/pulls/${pullNumber}/reviews`,
      { auth: adminAuth },
    );

    const missing = wanted.filter(
      (review) =>
        !reviews.some(
          (existing) =>
            existing.user?.login === review.by &&
            existing.body === review.body &&
            (REVIEW_STATES[review.state] ?? []).includes(
              existing.state ?? "",
            ) &&
            existing.dismissed !== true &&
            existing.stale !== true,
        ),
    );

    if (missing.length === 0) {
      if (attempt === 0) {
        log(`Reviews already in place on #${pullNumber}`);
      }
      return;
    }

    for (const review of missing) {
      await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/pulls/${pullNumber}/reviews`,
        {
          method: "POST",
          auth: authFor(review.by),
          body: JSON.stringify({
            body: review.body,
            event: REVIEW_EVENTS[review.state],
          }),
          expectedStatuses: [200, 201],
        },
      );
      log(`Submitted ${review.state} review by ${review.by} on #${pullNumber}`);
    }

    // Give Gitea's async review-dismissal pass a chance to undo what we just
    // wrote, so the next loop can see it and put it back.
    await sleep(1500);
  }

  throw new Error(
    `Reviews on #${pullNumber} in ${owner}/${repo} kept being dismissed after 5 attempts.`,
  );
}

// ---------------------------------------------------------------------------
// Who a change is waiting on
// ---------------------------------------------------------------------------

/**
 * Set the assignee and the requested reviewers.
 *
 * **Requested and given are different facts.** A review already submitted is a
 * `SeedReview`; this is the other kind — Gitea holding the change open for
 * somebody who has not answered. A change list that never showed one had no
 * way to look crowded, and "four people asked, one has replied" is the ordinary
 * state of a real change request.
 *
 * Written with the author's own token, because requesting a review is an act
 * on the change rather than an administrative one, and Gitea refuses a request
 * naming the change's own author — so the author is dropped rather than
 * failing the seed over a line that reads perfectly well.
 */
async function ensureAssignments(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  pull: GiteaPull,
  assignment: SeedAssignment,
  author: string,
  log: (message: string) => void,
): Promise<void> {
  const reviewers = assignment.reviewers.filter((name) => name !== author);

  if (assignment.assignee) {
    // Read before writing, so a second seed run is the no-op the rest of this
    // file is. An unconditional PATCH succeeds and changes nothing, which is
    // worse than it sounds: it is the one line of output that made a warm
    // re-seed look like it had done something.
    const current = await giteaJson<{ assignees?: Array<{ login?: string }> }>(
      baseUrl,
      `${repoPath(owner, repo)}/issues/${pull.number}`,
      { auth },
    );

    const assigned = (current.assignees ?? []).map((person) => person.login);
    if (!assigned.includes(assignment.assignee)) {
      await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/issues/${pull.number}`,
        {
          method: "PATCH",
          auth,
          body: JSON.stringify({ assignees: [assignment.assignee] }),
          expectedStatuses: [200, 201, 403, 404, 422],
        },
      );
      log(`Assigned #${pull.number} to ${assignment.assignee}`);
    }
  }

  if (reviewers.length === 0) return;

  // Already asked, or already answered: either way Gitea has a review record
  // for them and asking again either errors or resets somebody's state.
  const existing = await giteaJson<GiteaReview[]>(
    baseUrl,
    `${repoPath(owner, repo)}/pulls/${pull.number}/reviews`,
    { auth },
  );
  const spoken = new Set(
    existing.map((review) => review.user?.login).filter(Boolean),
  );
  const missing = reviewers.filter((name) => !spoken.has(name));
  if (missing.length === 0) return;

  await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/pulls/${pull.number}/requested_reviewers`,
    {
      method: "POST",
      auth,
      body: JSON.stringify({ reviewers: missing }),
      expectedStatuses: [201, 403, 404, 422],
    },
  );
  log(`Requested reviews on #${pull.number} from ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Sign-off rules
// ---------------------------------------------------------------------------

/**
 * Turn the scenario's rules into the app's, which means resolving a document's
 * address into its identity.
 *
 * A seed author writes `nursing/hand-hygiene` because that is where they filed
 * the policy. A rule is written against the identity instead (ADR 0005), so it
 * survives the policy being retitled or refiled — which is exactly what one of
 * the seeded changes then does to it, and the rule has to still be pointing at
 * the same document afterwards or the demonstration is of nothing.
 */
function toSignOffRules(
  rules: readonly SeedSignOffRule[],
  uidFor: (address: string) => string,
): SignOffRule[] {
  return rules.map((rule) => ({
    scope: rule.scope,
    target:
      rule.scope === "document"
        ? uidFor(rule.target!)
        : rule.scope === "folder"
          ? rule.target!
          : "",
    teams: rule.teams,
    users: rule.users,
  }));
}

// ---------------------------------------------------------------------------
// Review threads
//
// Gitea has no thread primitive, so Bindersnap models a thread as pull-request
// issue comments carrying a trailing marker. Resolution is append-only: a
// resolve is a new comment, never an edit. The seed writes exactly the same
// shape the app does — see services/api/gitea-client/discussions.ts.
// ---------------------------------------------------------------------------

function threadMarker(
  kind: "thread" | "reply" | "resolve",
  threadId: string,
  extra?: Record<string, string>,
): string {
  const attrs = [`kind=${kind}`, `thread=${threadId}`];
  for (const [key, value] of Object.entries(extra ?? {})) {
    attrs.push(`${key}=${value}`);
  }
  return `<!-- bindersnap:v1 ${attrs.join(" ")} -->`;
}

function threadComment(
  body: string,
  kind: "thread" | "reply" | "resolve",
  threadId: string,
  extra?: Record<string, string>,
): string {
  const marker = threadMarker(kind, threadId, extra);
  return body ? `${body}\n\n${marker}` : marker;
}

async function ensureThread(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  owner: string,
  repo: string,
  pullNumber: number,
  thread: SeedThread,
  log: (message: string) => void,
): Promise<void> {
  const comments = await giteaJson<GiteaComment[]>(
    baseUrl,
    `${repoPath(owner, repo)}/issues/${pullNumber}/comments`,
    { auth: adminAuth },
  );

  const has = (marker: string): boolean =>
    comments.some((comment) => (comment.body ?? "").includes(marker));

  const post = async (author: string, body: string): Promise<void> => {
    await giteaRequest(
      baseUrl,
      `${repoPath(owner, repo)}/issues/${pullNumber}/comments`,
      {
        method: "POST",
        auth: authFor(author),
        body: JSON.stringify({ body }),
        expectedStatuses: [201],
      },
    );
  };

  if (!has(threadMarker("thread", thread.id))) {
    await post(thread.by, threadComment(thread.body, "thread", thread.id));
    log(`Opened review thread "${thread.id}" on #${pullNumber}`);
  }

  // Replies share one marker, so count them rather than matching on text.
  const replyMarker = threadMarker("reply", thread.id);
  const existingReplies = comments.filter((comment) =>
    (comment.body ?? "").includes(replyMarker),
  ).length;

  for (const reply of thread.replies.slice(existingReplies)) {
    await post(reply.by, threadComment(reply.body, "reply", thread.id));
    log(`Replied in thread "${thread.id}" on #${pullNumber}`);
  }

  if (
    thread.resolved &&
    !has(threadMarker("resolve", thread.id, { state: "resolved" }))
  ) {
    await post(
      thread.resolvedBy ?? thread.by,
      threadComment("", "resolve", thread.id, { state: "resolved" }),
    );
    log(`Resolved thread "${thread.id}" on #${pullNumber}`);
  }
}

// ---------------------------------------------------------------------------
// Publishing, and the other way a change ends
// ---------------------------------------------------------------------------

/**
 * Close a change without publishing it.
 *
 * **The label is not written down here, and that is the point.** A closed
 * change with somebody's request for work standing against it reads as
 * *declined*; one without reads as *withdrawn* — `resolveClosedOutcome` decides
 * that from the reviews, and a seed that declared the outcome instead would be
 * asserting a second answer to a question the product already answers.
 */
async function closeChange(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  pull: GiteaPull,
  log: (message: string) => void,
): Promise<void> {
  if (pull.state === "closed" || pull.merged) {
    log(`Pull request already closed: #${pull.number}`);
    return;
  }

  await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/issues/${pull.number}`,
    {
      method: "PATCH",
      auth,
      body: JSON.stringify({ state: "closed" }),
      expectedStatuses: [200, 201],
    },
  );
  log(`Closed pull request without publishing: #${pull.number}`);
}

/** One thing the seed does to one file, in Gitea's own wire shape. */
interface FileOperation {
  operation: "upload" | "rename" | "delete";
  path: string;
  from_path?: string;
  content?: string;
}

/** What a publish records about one document it touched. */
interface PublishedDocument {
  uid: string;
  /** The version this publish gives it. */
  version: number;
  /** What it is called, as the product spells it. */
  title: string;
  /** `nursing/hand-hygiene` — where it is filed after this change. */
  slugPath: string;
  /** The whole filename, identity segment included. */
  path: string;
}

/** What a publish records about one document it took off the record. */
interface ArchivedDocumentRef extends PublishedDocument {
  /** Its last version, or null if it never had one. */
  lastVersion: number | null;
}

/**
 * Merge the change — the first of the two steps the publish button performs.
 *
 * Split from the tagging because a binder-level change tags as many documents
 * as it touched, and archives others, where a document's own change tags
 * exactly one. The merge is identical in both and was worth having once.
 */
async function mergeChange(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  pull: GiteaPull,
  title: string,
  refreshReviews: () => Promise<void>,
  log: (message: string) => void,
): Promise<void> {
  if (pull.merged || pull.state === "closed") {
    log(`Pull request already merged: #${pull.number}`);
    return;
  }

  // Gitea computes mergeability asynchronously and answers 405 until it has.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await giteaRequest(
      baseUrl,
      `${repoPath(owner, repo)}/pulls/${pull.number}/merge`,
      {
        method: "POST",
        auth,
        body: JSON.stringify({
          Do: "merge",
          MergeTitleField: title,
          MergeMessageField: "",
        }),
        expectedStatuses: [200, 405],
      },
    );

    if (response.status === 200) {
      log(`Merged pull request #${pull.number}`);
      return;
    }

    const reason = await response.text();
    if (attempt === 9) {
      throw new Error(
        `Could not merge #${pull.number} in ${owner}/${repo} after 10 attempts: ${reason}`,
      );
    }
    if (reason.includes("approvals")) {
      await refreshReviews();
    }
    await sleep(1000);
  }
}

/**
 * The annotated tags a publish writes, which are the evidence.
 *
 * **The message is the app's own stamp**, not an approximation of it. It used
 * to be one summary line, which read fine in `git tag -l` and answered none of
 * the questions the stamp exists for: the binder's list reads the change number
 * back out of it, and the archive reads the title and the path — an archived
 * document is not on `main`, so its tags are the only record of what it was
 * called. A seeded binder written without them looked right until a screen
 * asked one of those questions.
 *
 * `version` comes from the change's position in the scenario rather than from
 * counting existing tags, so a second seed run re-derives the same tag name and
 * does nothing instead of inventing a version nobody published.
 */
async function tagPublish(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  pull: GiteaPull,
  publishedBy: string,
  requiredApprovals: number,
  approvedBy: string[],
  published: readonly PublishedDocument[],
  archived: readonly ArchivedDocumentRef[],
  log: (message: string) => void,
): Promise<void> {
  const policy = {
    requiredApprovals,
    approvedBy,
    // Both of the binder's own rules, as the seed sets them. The seed cannot
    // reach the API's settings store, so the first is always the default; the
    // second is what `ensureMainBranchProtection` writes, which is on.
    blockOnUnresolvedThreads: false,
    signOffEnforced: true,
    publishedBy,
    changeNumber: pull.number,
  };

  const write = async (tagName: string, message: string): Promise<void> => {
    const response = await giteaRequest(
      baseUrl,
      `${repoPath(owner, repo)}/tags`,
      {
        method: "POST",
        auth,
        body: JSON.stringify({ tag_name: tagName, target: "main", message }),
        expectedStatuses: [201, 409, 422],
      },
    );

    log(
      response.status === 201
        ? `Tagged: ${owner}/${repo} ${tagName}`
        : `Already tagged: ${owner}/${repo} ${tagName}`,
    );
  };

  // A binder's tags are repository-global and many documents share them, so
  // the version has to carry the document with it — and it carries the
  // *identity*, not the path (ADR 0005), so renaming a policy does not restart
  // its numbering. The message carries what the name stopped saying.
  for (const document of published) {
    await write(
      `${document.uid}/v${document.version}`,
      buildVersionStamp({ ...policy, ...document }),
    );
  }

  for (const document of archived) {
    await write(
      `${document.uid}/archived-1`,
      buildArchiveStamp({
        title: document.title,
        slugPath: document.slugPath,
        path: document.path,
        lastVersion: document.lastVersion,
        sequence: 1,
        archivedBy: publishedBy,
        changeNumber: pull.number,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Tokens and OAuth
// ---------------------------------------------------------------------------

async function createAccessToken(
  baseUrl: string,
  adminAuth: BasicAuth,
  tokenNamePrefix: string,
  log: (message: string) => void,
): Promise<{ token: string; tokenName: string }> {
  const tokenName = `${tokenNamePrefix}-${Date.now()}`;
  const token = await giteaJson<GiteaToken>(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(adminAuth.username)}/tokens`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({ name: tokenName, scopes: ["all"] }),
      expectedStatuses: [201],
    },
  );

  if (!token.sha1) {
    throw new Error(
      "Token creation succeeded but no token value was returned.",
    );
  }

  log(`Created token: ${tokenName}`);
  return { token: token.sha1, tokenName };
}

export async function isTokenValid(
  baseUrl: string,
  token: string,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    return false;
  }

  const response = await fetch(new URL("/api/v1/user", baseUrl), {
    headers: { Authorization: `token ${trimmed}` },
  });
  return response.status === 200;
}

async function ensureOAuthApp(
  baseUrl: string,
  auth: BasicAuth,
  appName: string,
  redirectUri: string,
  log: (msg: string) => void,
): Promise<string> {
  const existing = await giteaJson<GiteaOAuthApp[]>(
    baseUrl,
    "/api/v1/user/applications/oauth2",
    { auth },
  );
  const found = existing.find((app) => app.name === appName);
  if (found) {
    log(
      `OAuth2 app "${appName}" already exists (client_id: ${found.client_id}).`,
    );
    return found.client_id;
  }

  const created = await giteaJson<GiteaOAuthApp>(
    baseUrl,
    "/api/v1/user/applications/oauth2",
    {
      method: "POST",
      auth,
      body: JSON.stringify({
        name: appName,
        redirect_uris: [redirectUri],
        confidential_client: false,
      }),
      expectedStatuses: [201],
    },
  );
  log(`OAuth2 app "${appName}" created (client_id: ${created.client_id}).`);
  return created.client_id;
}

// ---------------------------------------------------------------------------
// The scenario walk
// ---------------------------------------------------------------------------

/**
 * What every step below needs to know about the binder it is working in.
 *
 * A document no longer carries an owner — the organization owns it, and the
 * binder decides who may act on it — so the pieces that used to read
 * `document.owner` read this instead.
 */
interface BinderContext {
  /** The organization: the binder's Gitea owner. */
  owner: string;
  /** The binder's repository name. */
  repo: string;
  /** Who created the organization, and so authors by default. */
  organizationOwner: string;
  /** How many approvals a change here needs, for the version stamp. */
  requiredApprovals: number;
}

/**
 * Where everything in the binder is, as the seed walks it.
 *
 * **The binder is walked in order and its shape changes underneath.** A folder
 * is made, a policy is refiled, another is taken off the record — and the act
 * after each of those is written against the binder as it then stands. Nothing
 * here can be read back out of Gitea instead: a re-run has to derive the same
 * version numbers and the same tag names as the first run, so the counting is
 * the scenario's and not the stack's.
 */
interface BinderState {
  /** By the address the YAML filed it at, which its identity comes from. */
  documents: Map<string, SeedDocumentState>;
  /** Where each document is now, so an act can name it as a person would. */
  byAddress: Map<string, SeedDocumentState>;
  /** Every file on `main`, furniture included — a folder rename moves them all. */
  paths: Set<string>;
}

interface SeedDocumentState {
  /** The address the identity was derived from. It never changes. */
  declaredPath: string;
  uid: string;
  /** What it is stored as, so a later act can re-render it in the same format. */
  format: SeedDocumentFormat;
  extension: string;
  /** Where it is filed now. A move changes this and not the identity. */
  address: string;
  /** Its file on `main`, or null while nothing has published it. */
  path: string | null;
  /** How many versions it has published. */
  version: number;
  /** What the last published version called it. */
  title: string;
}

/**
 * A copy of the binder's shape, to plan a change that will not land on it.
 *
 * Deep over the document states as well as the maps: an act sets `address` and
 * `path` on the state itself, so sharing them would let a proposal rewrite the
 * binder it is only proposing to change.
 */
function cloneState(state: BinderState): BinderState {
  const documents = new Map<string, SeedDocumentState>();
  const byAddress = new Map<string, SeedDocumentState>();

  for (const [declaredPath, entry] of state.documents) {
    documents.set(declaredPath, { ...entry });
  }
  for (const [address, entry] of state.byAddress) {
    byAddress.set(address, documents.get(entry.declaredPath)!);
  }

  return { documents, byAddress, paths: new Set(state.paths) };
}

/** `nursing/hand-hygiene.01J8….md` — the address, the identity, the extension. */
function filePathFor(state: SeedDocumentState, address: string): string {
  return `${address}.${state.uid}${state.extension}`;
}

async function applyChange(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  context: BinderContext,
  state: BinderState,
  document: SeedBinderDocument,
  change: SeedChange,
  log: (message: string) => void,
): Promise<number> {
  const { owner, repo } = context;
  const slugPath = binderDocumentSlugPath(document);
  const entry = state.documents.get(slugPath)!;
  const author = change.author ?? context.organizationOwner;
  const authorAuth = authFor(author);
  const file = await renderSeedDocumentFile(
    change.document,
    document.format,
    slugPath,
    entry.uid,
  );

  await ensureBranch(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    "main",
    log,
  );
  await ensureFile(
    baseUrl,
    authorAuth,
    owner,
    repo,
    file.path,
    file.content,
    `seed: ${change.title}`,
    change.branch,
    log,
  );

  const pull = await ensurePullRequest(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    change.title,
    change.summary,
    log,
  );

  const refreshReviews = (): Promise<void> =>
    ensureReviews(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      change.reviews,
      log,
    );

  await refreshReviews();
  await ensureAssignments(
    baseUrl,
    authorAuth,
    owner,
    repo,
    pull,
    change,
    author,
    log,
  );

  for (const thread of change.threads) {
    await ensureThread(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      thread,
      log,
    );
  }

  if (change.closed) {
    await closeChange(baseUrl, adminAuth, owner, repo, pull, log);
  }

  if (change.publish) {
    entry.version += 1;
    entry.title = change.document.title;
    entry.path = file.path;
    state.paths.add(file.path);

    await mergeChange(
      baseUrl,
      adminAuth,
      owner,
      repo,
      pull,
      change.title,
      refreshReviews,
      log,
    );
    await tagPublish(
      baseUrl,
      adminAuth,
      owner,
      repo,
      pull,
      author,
      context.requiredApprovals,
      approversOf(change),
      [
        {
          uid: entry.uid,
          version: entry.version,
          title: change.document.title,
          slugPath: entry.address,
          path: file.path,
        },
      ],
      [],
      log,
    );
  }

  return pull.number;
}

/** Who approved, as the stamp records it: one line per person, not per review. */
function approversOf(change: SeedChange | SeedBinderChange): string[] {
  return [
    ...new Set(
      change.reviews
        .filter((review) => review.state === "approved")
        .map((review) => review.by),
    ),
  ];
}

/**
 * Turn a change's acts into the file operations that carry them out.
 *
 * **One commit, not one per act.** Gitea's `POST /repos/{owner}/{repo}/contents`
 * applies a whole list atomically, which is how the app does it and what makes
 * renaming a folder of twelve policies one thing a reviewer reads rather than
 * twelve that can half-apply.
 *
 * The state is advanced as each act is planned, because the act after a rename
 * is written against the name the rename gave it.
 */
async function planActs(
  context: BinderContext,
  state: BinderState,
  acts: readonly SeedAct[],
): Promise<{
  operations: FileOperation[];
  /** The documents this change gives a new version to, if it publishes. */
  touched: SeedDocumentState[];
  archived: ArchivedDocumentRef[];
}> {
  const operations: FileOperation[] = [];
  /** By identity, so two acts on one document produce one version. */
  const touched = new Map<string, SeedDocumentState>();
  const archived: ArchivedDocumentRef[] = [];

  const move = (from: string, to: string): void => {
    operations.push({ operation: "rename", path: to, from_path: from });
    state.paths.delete(from);
    state.paths.add(to);
  };

  for (const act of acts) {
    switch (act.kind) {
      case "newFolder": {
        // Git has no empty directories, so a folder somebody made and has not
        // filed anything in yet is this file and nothing else.
        const path = `${act.folder}/.gitkeep`;
        operations.push({ operation: "upload", path, content: "" });
        state.paths.add(path);
        break;
      }

      case "renameFolder": {
        for (const path of [...state.paths]) {
          if (!path.startsWith(`${act.from}/`)) continue;
          move(path, act.to + path.slice(act.from.length));
        }
        for (const entry of [...state.byAddress.values()]) {
          if (!entry.address.startsWith(`${act.from}/`)) continue;
          const moved = act.to + entry.address.slice(act.from.length);
          const wasOnMain = entry.path !== null;
          state.byAddress.delete(entry.address);
          entry.address = moved;
          state.byAddress.set(moved, entry);
          // A document the folder holds but `main` does not has no file to
          // move and no version to claim — its own change is still open, and
          // tagging it here would point a version at a path that is not there.
          if (wasOnMain) {
            entry.path = filePathFor(entry, moved);
            touched.set(entry.uid, entry);
          }
        }
        break;
      }

      case "move": {
        const entry = state.byAddress.get(act.from)!;
        const to = filePathFor(entry, act.to);
        move(entry.path!, to);
        state.byAddress.delete(act.from);
        entry.address = act.to;
        entry.path = to;
        state.byAddress.set(act.to, entry);
        touched.set(entry.uid, entry);
        break;
      }

      case "revise": {
        const entry = state.byAddress.get(act.document)!;
        const file = await renderSeedDocumentFile(
          act.contents,
          entry.format,
          entry.address,
          entry.uid,
        );
        operations.push({
          operation: "upload",
          path: file.path,
          content: file.content,
        });
        state.paths.add(file.path);
        entry.path = file.path;
        entry.title = act.contents.title;
        touched.set(entry.uid, entry);
        break;
      }

      case "archive": {
        const entry = state.byAddress.get(act.document)!;
        operations.push({ operation: "delete", path: entry.path! });
        state.paths.delete(entry.path!);
        state.byAddress.delete(act.document);
        archived.push({
          uid: entry.uid,
          // An archive tags no version; the field is here because the two
          // tag kinds share a shape, and the stamp reads the other four.
          version: entry.version,
          lastVersion: entry.version === 0 ? null : entry.version,
          title: formatDocumentName(entry.address.split("/").pop()!),
          slugPath: entry.address,
          path: entry.path!,
        });
        // Taken off the record, so nothing later in this change may touch it.
        touched.delete(entry.uid);
        break;
      }

      case "signOff": {
        const rules = toSignOffRules(
          act.rules,
          (address) => state.byAddress.get(address)!.uid,
        );
        operations.push({
          operation: "upload",
          path: CODEOWNERS_PATH,
          content: Buffer.from(
            renderCodeowners(context.owner, rules),
            "utf8",
          ).toString("base64"),
        });
        state.paths.add(CODEOWNERS_PATH);
        break;
      }
    }
  }

  return { operations, touched: [...touched.values()], archived };
}

/** The version a publish gives each document it touched, and its stamp facts. */
function claimVersions(
  touched: readonly SeedDocumentState[],
): PublishedDocument[] {
  return touched.map((entry) => {
    // Claimed from the scenario rather than from counting tags, so a change
    // touching three documents advances all three, and a re-run derives the
    // same numbers instead of inventing versions nobody published.
    entry.version += 1;
    return {
      uid: entry.uid,
      version: entry.version,
      title: formatDocumentName(entry.address.split("/").pop()!),
      slugPath: entry.address,
      path: entry.path!,
    };
  });
}

/**
 * A change about the binder rather than about one document.
 *
 * **Committed once, and only when the branch is new.** The operations are a
 * list of moves and deletes against a particular tree, so replaying them onto
 * a branch that already has them applied is not a no-op — it is a rename of a
 * file that is no longer there. A branch the seed already made is therefore
 * left exactly as it stands, which is the same thing that happens to a real
 * change request: its commit has already been made.
 */
async function applyBinderChange(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  context: BinderContext,
  state: BinderState,
  change: SeedBinderChange,
  log: (message: string) => void,
): Promise<number> {
  const { owner, repo } = context;
  const author = change.author ?? context.organizationOwner;
  const authorAuth = authFor(author);

  // **A change that is not published has not happened.** Planning its acts
  // moves documents and makes folders, and every act after it — in this change
  // or the next — is written against the binder as it then stands. An open
  // change proposing a rename must not leave the seed believing the rename
  // landed, or the change after it renames a file that is still where it was.
  const workingState = change.publish ? state : cloneState(state);

  const { operations, touched, archived } = await planActs(
    context,
    workingState,
    change.acts,
  );

  const created = await ensureBranch(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    "main",
    log,
  );

  if (created) {
    await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents`, {
      method: "POST",
      auth: authorAuth,
      body: JSON.stringify({
        branch: change.branch,
        message: `seed: ${change.title}`,
        files: operations,
      }),
      expectedStatuses: [200, 201],
    });
    log(
      `Committed ${operations.length} file operations: ${owner}/${repo}@${change.branch}`,
    );
  } else {
    log(`Branch already carries its commit: ${change.branch}`);
  }

  const pull = await ensurePullRequest(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    change.title,
    change.summary,
    log,
  );

  const refreshReviews = (): Promise<void> =>
    ensureReviews(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      change.reviews,
      log,
    );

  await refreshReviews();
  await ensureAssignments(
    baseUrl,
    authorAuth,
    owner,
    repo,
    pull,
    change,
    author,
    log,
  );

  for (const thread of change.threads) {
    await ensureThread(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      thread,
      log,
    );
  }

  if (change.closed) {
    await closeChange(baseUrl, adminAuth, owner, repo, pull, log);
  }

  if (change.publish) {
    const published = claimVersions(touched);

    await mergeChange(
      baseUrl,
      adminAuth,
      owner,
      repo,
      pull,
      change.title,
      refreshReviews,
      log,
    );
    await tagPublish(
      baseUrl,
      adminAuth,
      owner,
      repo,
      pull,
      author,
      context.requiredApprovals,
      approversOf(change),
      published,
      archived,
      log,
    );
  }

  return pull.number;
}

/**
 * The binder itself: one repository owned by the organization, with `main`
 * protected and the three role teams granted onto it.
 *
 * Members are added to those teams rather than as per-repository
 * collaborators, because access is uniform within a workspace — that is the
 * whole reason the level exists.
 */
async function applyBinder(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  organization: SeedOrganization,
  binder: SeedBinder,
  staffTeamId: number | null,
  log: (message: string) => void,
): Promise<Record<string, number>> {
  const owner = organization.name;
  const repo = binder.name;

  await ensureOrgRepo(baseUrl, adminAuth, owner, repo, binder.description, log);
  await bootstrapEmptyMainBranch(baseUrl, adminAuth, owner, repo, log);

  const context: BinderContext = {
    owner,
    repo,
    organizationOwner: organization.owner,
    requiredApprovals: binder.requiredApprovals,
  };

  const state: BinderState = {
    documents: new Map(),
    byAddress: new Map(),
    paths: new Set(),
  };

  for (const document of binder.documents) {
    const declaredPath = binderDocumentSlugPath(document);
    const entry: SeedDocumentState = {
      declaredPath,
      uid: seedDocumentUid(owner, repo, declaredPath),
      format: document.format,
      extension: canonicalFileNameFor(document.format).replace(/^document/, ""),
      address: declaredPath,
      path: null,
      version: 0,
      title: declaredPath,
    };
    state.documents.set(declaredPath, entry);
    state.byAddress.set(declaredPath, entry);
  }

  // **Before `main` is protected**, because a protected branch takes no direct
  // push — and because these are the rules the seed's own changes are then
  // governed by, which is the state a binder with sign-off rules is actually
  // in. A change that proposes new ones is a separate act and goes through the
  // ordinary path, like everything else.
  if (binder.signOff.length > 0) {
    const rules = toSignOffRules(
      binder.signOff,
      (address) => state.byAddress.get(address)!.uid,
    );
    await ensureFile(
      baseUrl,
      adminAuth,
      owner,
      repo,
      CODEOWNERS_PATH,
      Buffer.from(renderCodeowners(owner, rules), "utf8").toString("base64"),
      "seed: who signs off on this binder",
      "main",
      log,
    );
    state.paths.add(CODEOWNERS_PATH);
  }

  await ensureBinderTeams(baseUrl, adminAuth, owner, repo, binder, log);
  await ensureBinderGroups(
    baseUrl,
    adminAuth,
    owner,
    repo,
    binder,
    staffTeamId,
    log,
  );
  await ensureMainBranchProtection(
    baseUrl,
    adminAuth,
    owner,
    repo,
    binder.requiredApprovals,
    log,
  );

  const pullRequests: Record<string, number> = {};

  for (const document of binder.documents) {
    for (const change of document.changes) {
      const number = await applyChange(
        baseUrl,
        adminAuth,
        authFor,
        context,
        state,
        document,
        change,
        log,
      );
      pullRequests[`${owner}/${repo}#${change.branch}`] = number;
    }
  }

  // After every document's own, so a folder rename has folders to rename and a
  // move has a published file to move.
  for (const change of binder.changes) {
    const number = await applyBinderChange(
      baseUrl,
      adminAuth,
      authFor,
      context,
      state,
      change,
      log,
    );
    pullRequests[`${owner}/${repo}#${change.branch}`] = number;
  }

  return pullRequests;
}

/**
 * The groups granted onto this binder, and whether the whole staff can read it.
 *
 * Both are grants of an organization team onto a repository, which is why they
 * are one step: "open to the organization" is the `staff` team granted, and
 * nothing else. Revoking matters as much as granting — a binder that was open
 * and is now marked closed has to actually close on the next run.
 */
async function ensureBinderGroups(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  binder: SeedBinder,
  staffTeamId: number | null,
  log: (message: string) => void,
): Promise<void> {
  for (const group of binder.groups) {
    const team = await findTeam(baseUrl, adminAuth, owner, group);
    if (!team) continue;
    await giteaRequest(
      baseUrl,
      `/api/v1/teams/${team.id}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { method: "PUT", auth: adminAuth, expectedStatuses: [204, 404, 405] },
    );
    log(`Granted group ${group} on ${owner}/${repo}`);
  }

  if (staffTeamId === null) return;

  await giteaRequest(
    baseUrl,
    `/api/v1/teams/${staffTeamId}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      method: binder.openToOrganization ? "PUT" : "DELETE",
      auth: adminAuth,
      expectedStatuses: [204, 404, 405],
    },
  );
  log(
    binder.openToOrganization
      ? `Opened ${owner}/${repo} to the whole organization`
      : `Kept ${owner}/${repo} to its own members`,
  );
}

export async function seedDevStack(
  options: SeedOptions = {},
): Promise<SeedResult> {
  const scenario = options.scenario ?? loadSeedScenario(SCENARIO_URL);
  const baseUrl = options.baseUrl ?? process.env.GITEA_URL ?? DEFAULT_GITEA_URL;
  const password =
    options.adminPass ?? process.env.GITEA_ADMIN_PASS ?? scenario.password;
  const createToken = options.createToken ?? true;
  const tokenNamePrefix = options.tokenNamePrefix ?? "bindersnap-dev";
  const log = options.log ?? ((message: string) => console.log(message));

  const adminUser =
    options.adminUser ??
    process.env.GITEA_ADMIN_USER ??
    scenario.users[0]?.username;
  if (!adminUser) {
    throw new Error("The seed scenario declares no users.");
  }

  const adminAuth: BasicAuth = { username: adminUser, password };
  const authFor = (username: string): BasicAuth => ({ username, password });

  log("Waiting for Gitea...");
  await waitForUrl(baseUrl, "/", 30, 2000);
  await maybeBootstrapInstall(
    baseUrl,
    adminUser,
    password,
    scenario.users.find((user) => user.username === adminUser)?.email ??
      `${adminUser}@example.com`,
    log,
  );
  await waitForUrl(baseUrl, "/api/v1/settings/api", 30, 2000);
  log("Gitea is ready.");

  // **The install admin included.** Gitea made that account from the install
  // form, which takes a login and an email and no name — so the one account
  // every developer signs in as was the only one with no full name, and every
  // screen that shows a person showed a bare login beside ten people with
  // proper names. Their site-admin flag is left exactly as it is: the seed
  // authenticates as them, and demoting them would lock it out of its own
  // stack.
  await refreshAdminProfile(
    baseUrl,
    adminAuth,
    scenario.users.find((user) => user.username === adminUser),
    log,
  );

  for (const user of scenario.users) {
    if (user.username === adminUser) {
      continue;
    }
    await ensureUser(
      baseUrl,
      adminAuth,
      user.username,
      password,
      user.email,
      user.fullName,
      user.siteAdmin,
      log,
    );
  }

  await ensureOrganization(baseUrl, adminAuth, scenario, log);
  await ensureOrganizationGroups(
    baseUrl,
    adminAuth,
    scenario.organization.name,
    scenario.organization.groups,
    log,
  );

  const staffTeamId = await ensureStaffTeamId(
    baseUrl,
    adminAuth,
    scenario.organization.name,
    log,
  );
  if (staffTeamId !== null) {
    await ensureStaffMembers(baseUrl, adminAuth, staffTeamId, scenario);
  }

  const pullRequests: Record<string, number> = {};
  for (const binder of scenario.binders) {
    Object.assign(
      pullRequests,
      await applyBinder(
        baseUrl,
        adminAuth,
        authFor,
        scenario.organization,
        binder,
        staffTeamId,
        log,
      ),
    );
  }

  const redirectUri = `http://localhost:${process.env.APP_PORT ?? "5173"}/auth/callback`;
  const oauthClientId = await ensureOAuthApp(
    baseUrl,
    adminAuth,
    "bindersnap-dev",
    redirectUri,
    log,
  );

  const result: SeedResult = {
    pullRequests,
    prNumber: pullRequests[PRIMARY_CHANGE] ?? 0,
    secondPrNumber: pullRequests[SECONDARY_CHANGE] ?? 0,
    oauthClientId,
  };

  if (!createToken) {
    return result;
  }

  const tokenInfo = await createAccessToken(
    baseUrl,
    adminAuth,
    tokenNamePrefix,
    log,
  );
  return { ...result, token: tokenInfo.token, tokenName: tokenInfo.tokenName };
}

async function runCli(): Promise<void> {
  const scenario = loadSeedScenario(SCENARIO_URL);
  const result = await seedDevStack({ scenario });
  const password = process.env.GITEA_ADMIN_PASS ?? scenario.password;

  console.log("");
  console.log("==================================================");
  console.log(
    `Sign in at http://localhost:${process.env.APP_PORT ?? "5173"} as any of:`,
  );
  for (const user of scenario.users) {
    const role = user.role ? ` — ${user.role}` : "";
    console.log(`  ${user.username} / ${password}${role}`);
  }
  console.log("");
  const documentCount = scenario.binders.reduce(
    (total, binder) => total + binder.documents.length,
    0,
  );
  console.log(
    `Seeded ${documentCount} documents across ${scenario.binders.length} binders in ${scenario.organization.name}.`,
  );
  if (result.oauthClientId) {
    console.log(`OAUTH_CLIENT_ID=${result.oauthClientId}`);
    console.log("Add to .env:");
    console.log(`  BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID=${result.oauthClientId}`);
  }
  if (result.token) {
    console.log(`TOKEN_NAME=${result.tokenName}`);
    console.log(`ALICE_TOKEN_SUFFIX=...${result.token.slice(-8)}`);
    console.log(
      "Token created. Set VITE_GITEA_TOKEN manually in your shell if needed.",
    );
  }
  console.log("==================================================");
  console.log("Seed complete.");
}

const invokedDirectly = (() => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return pathToFileURL(entryPath).href === import.meta.url;
})();

if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
