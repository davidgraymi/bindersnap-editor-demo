/**
 * ADR 0004, migration step 1: signup creates the organization and its first
 * binder, and the new user owns both.
 *
 * "There is no personal mode that has to be upgraded later, because that
 * upgrade is the migration being paid for now." This asserts the end of that
 * sentence against a real stack: after one POST to /auth/signup there is a
 * Gitea org, a private repository it owns, three role teams granted onto that
 * repository, and a protected `main` carrying the approvals whitelist without
 * which free reviewers are decorative.
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
  // randomUUID rather than Math.random: this builds a password, and a
  // predictable one in a fixture is still a bad habit to copy.
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `provision-${suffix}`,
    email: `provision-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

async function signUp(credentials: Credentials): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ ...credentials, organization: "Mercy Health" }),
  });

  // Read the body once. `expect`'s message argument is evaluated eagerly, so
  // awaiting `response.text()` inside it consumes the body before anything
  // else can read it.
  const body = await response.text();
  expect(response.status, `signup failed: ${body}`).toBe(200);
}

/** Read Gitea as the newly created user, with their own token. */
async function giteaGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITEA_URL}/api/v1${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/json" },
  });

  const body = await response.text();
  expect(response.status, `GET ${path} failed: ${body}`).toBe(200);

  return JSON.parse(body) as T;
}

test("signup creates the organization, its first binder, and its rules", async () => {
  const credentials = buildCredentials();
  await signUp(credentials);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // The user is a member of exactly one organization, and it is not named
  // after them: Gitea keeps users and orgs in one namespace.
  const orgs = await giteaGet<Array<{ username: string }>>(token, "/user/orgs");
  expect(orgs).toHaveLength(1);
  const org = orgs[0]!.username;
  expect(org).not.toBe(credentials.username);
  // The requested display name, slugified. A suffix appears when an earlier
  // run already took the bare name — the name is not an identifier, the org id
  // is, so that is fine.
  expect(org).toMatch(/^mercy-health(-\d+)?$/);

  // Ownership survives personnel changes because the org owns the binder — the
  // whole point of ADR 0004's first level.
  const repo = await giteaGet<{
    private: boolean;
    owner: { login: string };
    default_branch: string;
  }>(token, `/repos/${org}/policies`);
  expect(repo.owner.login).toBe(org);
  expect(repo.private).toBe(true);
  expect(repo.default_branch).toBe("main");

  const teams = await giteaGet<Array<{ name: string }>>(
    token,
    `/orgs/${org}/teams`,
  );
  const names = teams.map((team) => team.name).sort();
  // Owners is Gitea's own, and the creator is in it — that is what makes them
  // the person who can change billing.
  expect(names).toEqual([
    "Owners",
    "policies-admins",
    "policies-authors",
    "policies-reviewers",
  ]);

  const protection = await giteaGet<{
    enable_push: boolean;
    required_approvals: number;
    enable_approvals_whitelist: boolean;
    approvals_whitelist_teams: string[];
    block_on_official_review_requests: boolean;
  }>(token, `/repos/${org}/policies/branch_protections/main`);

  // Nothing reaches main except a merged, approved change.
  expect(protection.enable_push).toBe(false);
  expect(protection.required_approvals).toBeGreaterThan(0);

  // And the field the free-reviewer tier lives or dies on. Gitea's default
  // resolves "official reviewer" as "has write access on repo.code", which
  // would make every reviewer's approval count for nothing.
  expect(protection.enable_approvals_whitelist).toBe(true);
  expect(protection.approvals_whitelist_teams.sort()).toEqual([
    "policies-admins",
    "policies-authors",
    "policies-reviewers",
  ]);
  expect(protection.block_on_official_review_requests).toBe(true);
});

test("a second signup gets its own organization rather than colliding", async () => {
  const first = buildCredentials();
  const second = buildCredentials();

  await signUp(first);
  await signUp(second);

  const secondToken = await createUserToken(second.username, second.password);
  const orgs = await giteaGet<Array<{ username: string }>>(
    secondToken,
    "/user/orgs",
  );

  expect(orgs).toHaveLength(1);
  // Both asked for "Mercy Health"; the name is not an identifier, so the
  // second one is suffixed rather than refused.
  expect(orgs[0]!.username).toMatch(/^mercy-health(-\d+)?$/);

  const firstToken = await createUserToken(first.username, first.password);
  const firstOrgs = await giteaGet<Array<{ username: string }>>(
    firstToken,
    "/user/orgs",
  );
  expect(firstOrgs[0]!.username).not.toBe(orgs[0]!.username);
});
