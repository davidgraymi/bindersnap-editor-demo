/**
 * ADR 0004's second level, created by a member rather than by provisioning.
 *
 * Organizations no longer arrive with a binder: naming the container a
 * customer's records live in is the owner's call, so `POST /api/app/workspaces`
 * is how one comes to exist. This asserts that against a real stack — the
 * repository is owned by the organization, `main` is protected, and the three
 * role teams are granted onto it, which is what makes a free reviewer's
 * approval count.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  APP_BASE_URL,
  createUserToken,
  GITEA_URL,
} from "./helpers";

test.describe.configure({ mode: "serial", timeout: 120_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `binder-${suffix}`,
    email: `binder-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

async function signUp(credentials: Credentials): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify(credentials),
  });

  const body = await response.text();
  expect(response.status, `signup failed: ${body}`).toBe(200);

  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  expect(match?.[1], "no session cookie in the signup response").toBeTruthy();
  return match![1]!;
}

function authHeaders(sessionCookie: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${sessionCookie}`,
    "Content-Type": "application/json",
    // A mutation, so it goes through the state-changing origin check.
    Origin: APP_BASE_URL,
  };
}

async function createOrganization(
  sessionCookie: string,
  name: string,
): Promise<{ id: number; name: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name }),
  });

  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: { id: number; name: string } })
    .organization;
}

interface WorkspaceSummary {
  id: number;
  name: string;
  owner: string;
  fullName: string;
  description: string;
}

async function createWorkspace(
  sessionCookie: string,
  name: string,
  description?: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/workspaces`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name, description }),
  });
  return { status: response.status, body: await response.text() };
}

async function listWorkspaces(
  sessionCookie: string,
): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/app/workspaces`, {
    headers: { Cookie: `bindersnap_session=${sessionCookie}` },
  });
  const body = await response.text();
  expect(response.status, `list workspaces failed: ${body}`).toBe(200);
  return (JSON.parse(body) as { workspaces: WorkspaceSummary[] }).workspaces;
}

async function giteaGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITEA_URL}/api/v1${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/json" },
  });
  const body = await response.text();
  expect(response.status, `GET ${path} failed: ${body}`).toBe(200);
  return JSON.parse(body) as T;
}

test("an account with no organization has no binders, and is not an error", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);

  // Reading is never gated, and having no organization is an ordinary state
  // now that one is something a person creates.
  expect(await listWorkspaces(sessionCookie)).toEqual([]);

  const attempt = await createWorkspace(sessionCookie, "Clinical Policies");
  expect(attempt.status).toBe(402);
});

test("a member creates the binder, and it belongs to the organization", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  // A fresh organization owns nothing until somebody makes something.
  expect(await listWorkspaces(sessionCookie)).toEqual([]);

  const created = await createWorkspace(
    sessionCookie,
    "Clinical Policies",
    "Nursing and clinical practice",
  );
  expect(created.status, created.body).toBe(201);

  const workspace = (
    JSON.parse(created.body) as { workspace: WorkspaceSummary }
  ).workspace;
  // What they typed is not what Gitea can be given, so the address is the slug.
  expect(workspace.name).toBe("clinical-policies");
  expect(workspace.owner).toBe(org.name);
  expect(workspace.fullName).toBe(`${org.name}/clinical-policies`);

  expect(await listWorkspaces(sessionCookie)).toEqual([workspace]);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // Owned by the organization, not by the person who made it — the whole point
  // of the level. Private, because a policy manual is not public by default.
  const repo = await giteaGet<{
    private: boolean;
    owner: { login: string };
    default_branch: string;
  }>(token, `/repos/${org.name}/clinical-policies`);
  expect(repo.owner.login).toBe(org.name);
  expect(repo.private).toBe(true);
  expect(repo.default_branch).toBe("main");

  // A binder holds policies, and it starts with none. Gitea's `auto_init` is
  // the only way to get a `main` to protect and it writes a README; left in
  // place that lists as a document called "README" in front of a surveyor.
  const contents = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical-policies/contents`,
    { headers: { Authorization: `token ${token}` } },
  );
  expect(contents.status).toBe(200);
  expect(await contents.json()).toEqual([]);

  const teams = await giteaGet<Array<{ name: string }>>(
    token,
    `/orgs/${org.name}/teams`,
  );
  expect(teams.map((team) => team.name).sort()).toEqual([
    "Owners",
    "clinical-policies-admins",
    "clinical-policies-authors",
    "clinical-policies-reviewers",
  ]);

  const protection = await giteaGet<{
    enable_push: boolean;
    required_approvals: number;
    enable_approvals_whitelist: boolean;
    approvals_whitelist_teams: string[];
    block_on_official_review_requests: boolean;
  }>(token, `/repos/${org.name}/clinical-policies/branch_protections/main`);

  // Nothing reaches main except a merged, approved change.
  expect(protection.enable_push).toBe(false);
  expect(protection.required_approvals).toBeGreaterThan(0);

  // And the field the free-reviewer tier lives or dies on: without it Gitea
  // resolves "official reviewer" as "has write access", which would make every
  // reviewer's approval count for nothing.
  expect(protection.enable_approvals_whitelist).toBe(true);
  expect(protection.approvals_whitelist_teams.sort()).toEqual([
    "clinical-policies-admins",
    "clinical-policies-authors",
    "clinical-policies-reviewers",
  ]);
  expect(protection.block_on_official_review_requests).toBe(true);
});

test("a second binder of the same name is refused, not silently reused", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await createWorkspace(sessionCookie, "Clinical Policies")).status,
  ).toBe(201);

  // Provisioning is idempotent, which is right for repairing a partial failure
  // and wrong for a person naming a new binder: they would be handed somebody
  // else's rules and think they had made their own.
  const second = await createWorkspace(sessionCookie, "Clinical Policies");
  expect(second.status).toBe(409);

  expect(await listWorkspaces(sessionCookie)).toHaveLength(1);
});

test("a binder whose name has nothing Gitea can use is refused", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const attempt = await createWorkspace(sessionCookie, "!!!");
  expect(attempt.status).toBe(400);
});
