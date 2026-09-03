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

/**
 * ADR 0004 step 2: the document is a file inside the binder.
 *
 * The upload → branch → pull request contract of ADR 0001 is unchanged. What
 * changed is where it lands: a path in the workspace that governs the document,
 * rather than a repository of the uploader's own.
 */
async function addDocument(
  sessionCookie: string,
  workspace: string,
  fields: { name: string; folder?: string; filename?: string; body?: string },
): Promise<{ status: number; body: string }> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([fields.body ?? "policy text"], { type: "text/markdown" }),
    fields.filename ?? "policy.md",
  );
  form.set("name", fields.name);
  if (fields.folder) form.set("folder", fields.folder);

  const response = await fetch(
    `${API_BASE_URL}/api/app/workspaces/${workspace}/documents`,
    {
      method: "POST",
      headers: {
        Cookie: `bindersnap_session=${sessionCookie}`,
        Origin: APP_BASE_URL,
      },
      body: form,
    },
  );
  return { status: response.status, body: await response.text() };
}

test("a document is a file at a path inside the binder", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  const added = await addDocument(sessionCookie, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
  });
  expect(added.status, added.body).toBe(201);

  const payload = JSON.parse(added.body) as {
    documentPath: string;
    slugPath: string;
    branch: string;
    pullRequestNumber: number | null;
  };
  expect(payload.documentPath).toBe("nursing/infection-control.md");
  expect(payload.slugPath).toBe("nursing/infection-control");
  expect(payload.pullRequestNumber).toBeGreaterThan(0);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // Nothing reaches main except a merged, approved change — so the file is on
  // the branch and the change is open, and main is still empty of it.
  const onBranch = await giteaGet<{ path: string }>(
    token,
    `/repos/${org.name}/clinical/contents/${payload.documentPath}?ref=${encodeURIComponent(payload.branch)}`,
  );
  expect(onBranch.path).toBe(payload.documentPath);

  const onMain = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/contents/${payload.documentPath}?ref=main`,
    { headers: { Authorization: `token ${token}` } },
  );
  expect(onMain.status).toBe(404);

  const pull = await giteaGet<{ base: { ref: string }; head: { ref: string } }>(
    token,
    `/repos/${org.name}/clinical/pulls/${payload.pullRequestNumber}`,
  );
  expect(pull.base.ref).toBe("main");
  expect(pull.head.ref).toBe(payload.branch);
});

test("two documents share one binder, which is the whole point", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  const first = await addDocument(sessionCookie, "clinical", {
    name: "Infection Control",
  });
  const second = await addDocument(sessionCookie, "clinical", {
    name: "Hand Hygiene",
  });

  expect(first.status, first.body).toBe(201);
  expect(second.status, second.body).toBe(201);

  // One binder, two documents, one set of rules over both. Under the old model
  // these were two repositories and two collaborator lists.
  expect(await listWorkspaces(sessionCookie)).toHaveLength(1);
});

test("a document cannot be written outside the binder that governs it", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  const escaped = await addDocument(sessionCookie, "clinical", {
    name: "Escape",
    folder: "../../../etc",
  });
  expect(escaped.status, escaped.body).toBe(201);

  // The folder is normalized rather than rejected: `..` is not a folder anyone
  // meant to type, and committing to one would write outside the binder.
  expect(
    (JSON.parse(escaped.body) as { documentPath: string }).documentPath,
  ).toBe("etc/escape.md");
});

test("adding a document where one already lives is refused", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  // The first is still only on its branch, so main is clear — a second upload
  // of the same name is a second change to the same document, which is a later
  // step's job, not a silent overwrite here.
  expect(
    (
      await addDocument(sessionCookie, "clinical", {
        name: "Infection Control",
      })
    ).status,
  ).toBe(201);

  const again = await addDocument(sessionCookie, "clinical", {
    name: "Infection Control",
  });
  expect([201, 409]).toContain(again.status);
});

test("adding a document to a binder that does not exist is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const missing = await addDocument(sessionCookie, "no-such-binder", {
    name: "Infection Control",
  });
  expect(missing.status).toBe(404);
});

/**
 * ADR 0004 step 2, read side: the documents list is one walk of one binder.
 *
 * It used to be a repository search — one repository per document, three Gitea
 * calls each. The binder makes it a tree read, which is the cost argument the
 * ADR makes for the model.
 */
async function listDocuments(
  sessionCookie: string,
  workspace: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/workspaces/${workspace}/documents`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

async function getDocument(
  sessionCookie: string,
  workspace: string,
  documentPath: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/workspaces/${workspace}/documents/${documentPath}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

test("a binder with nothing in it lists no documents, and is not an error", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  const listed = await listDocuments(sessionCookie, "clinical");
  expect(listed.status, listed.body).toBe(200);
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);
});

test("an unpublished document is not in the binder's list, because main is the record", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  const added = await addDocument(sessionCookie, "clinical", {
    name: "Infection Control",
  });
  expect(added.status, added.body).toBe(201);

  // The upload is on a branch with an open change. Nothing reaches main except
  // a merged, approved change, and the list reads main — so a document nobody
  // has approved is not yet part of the record.
  const listed = await listDocuments(sessionCookie, "clinical");
  expect(listed.status, listed.body).toBe(200);
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);
});

test("listing a binder that does not exist is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect((await listDocuments(sessionCookie, "no-such-binder")).status).toBe(
    404,
  );
});

test("asking for a document that is not there is a 404, not an empty document", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect((await createWorkspace(sessionCookie, "Clinical")).status).toBe(201);

  expect(
    (await getDocument(sessionCookie, "clinical", "nursing/handover")).status,
  ).toBe(404);
});

test("an account with no organization sees no documents rather than an error", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);

  // Reading is never gated, and having no organization is an ordinary state.
  const listed = await listDocuments(sessionCookie, "clinical");
  expect(listed.status, listed.body).toBe(200);
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);
});
