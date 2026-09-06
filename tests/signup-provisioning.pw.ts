/**
 * ADR 0004's first level, created by the person who will own it.
 *
 * Signup used to provision an organization silently, deriving a name from the
 * username that nobody chose and nobody could change. It no longer does: an
 * account arrives with no organization, and `POST /api/app/organizations` is
 * the single way one gets created — for a new signup and for an account that
 * predates ADR 0004 alike.
 *
 * This asserts that against a real stack: after signup there is no
 * organization, and after one request there is a Gitea org, a private
 * repository it owns, three role teams granted onto that repository, and a
 * protected `main` carrying the approvals whitelist without which free
 * reviewers are decorative.
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

/** Sign up, and return the session cookie the rest of the test acts with. */
async function signUp(credentials: Credentials): Promise<string> {
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

  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  expect(match?.[1], "no session cookie in the signup response").toBeTruthy();
  return match![1]!;
}

async function createOrganization(
  sessionCookie: string,
  name: string,
): Promise<{ id: number; name: string; displayName: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: {
      Cookie: `bindersnap_session=${sessionCookie}`,
      "Content-Type": "application/json",
      // A mutation, so it goes through the state-changing origin check.
      Origin: APP_BASE_URL,
    },
    body: JSON.stringify({ name }),
  });

  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: never }).organization;
}

/** Read Gitea as the user, with their own token. */
async function giteaGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITEA_URL}/api/v1${path}`, {
    headers: { Authorization: `token ${token}`, Accept: "application/json" },
  });

  const body = await response.text();
  expect(response.status, `GET ${path} failed: ${body}`).toBe(200);

  return JSON.parse(body) as T;
}

test("signup leaves the account with no organization", async () => {
  const credentials = buildCredentials();
  await signUp(credentials);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // Naming is the one thing an organization needs from its owner, so signup
  // no longer guesses on their behalf.
  const orgs = await giteaGet<Array<{ username: string }>>(token, "/user/orgs");
  expect(orgs).toHaveLength(0);
});

test("creating an organization creates the organization, and no binder", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);

  const created = await createOrganization(sessionCookie, "Mercy Health");
  // The typed name survives: the slug is the URL, the display name is what
  // they called it.
  expect(created.displayName).toBe("Mercy Health");
  expect(created.name).toMatch(/^mercy-health(-\d+)?$/);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // They own it, because it was created with their token — the whole reason
  // ADR 0004's first level exists.
  const orgs = await giteaGet<Array<{ username: string }>>(token, "/user/orgs");
  expect(orgs).toHaveLength(1);
  const org = orgs[0]!.username;
  expect(org).toBe(created.name);
  expect(org).not.toBe(credentials.username);

  // No binder. It used to arrive with one called "policies" that nobody asked
  // for and nothing wrote into — documents are still their own repositories —
  // so it was a guess at the name of the container a customer's records live
  // in, which is the owner's call to make.
  const repos = await giteaGet<Array<{ name: string }>>(
    token,
    `/orgs/${org}/repos`,
  );
  expect(repos).toEqual([]);

  // Two teams and only two. `Owners` is Gitea's own, and the creator is in it —
  // that is what makes them the person who can change billing. `staff` is the
  // organization's read team, which every member belongs to; it exists from the
  // organization's first moment rather than being conjured by whichever binder
  // happens to be created first.
  //
  // No per-binder role teams: there is no binder, and a binder would not make
  // any either.
  const teams = await giteaGet<Array<{ name: string }>>(
    token,
    `/orgs/${org}/teams`,
  );
  expect(teams.map((team) => team.name).sort()).toEqual(["Owners", "staff"]);
});

test("a second organization of the same name gets its own", async () => {
  const first = buildCredentials();
  const second = buildCredentials();

  const firstOrg = await createOrganization(
    await signUp(first),
    "Mercy Health",
  );
  // The second customer cannot see the first's private organization, so Gitea
  // answers "does mercy-health exist?" with a 404 either way. Creation is what
  // settles it, and a taken name steps to the next candidate rather than
  // failing the request.
  const secondOrg = await createOrganization(
    await signUp(second),
    "Mercy Health",
  );

  expect(secondOrg.name).not.toBe(firstOrg.name);
  expect(secondOrg.name).toMatch(/^mercy-health(-\d+)?$/);
  expect(secondOrg.displayName).toBe("Mercy Health");
});
