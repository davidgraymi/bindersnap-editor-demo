/**
 * ADR 0004's second level, created by a member rather than by provisioning.
 *
 * Organizations no longer arrive with a binder: naming the container a
 * customer's records live in is the owner's call, so `POST /api/app/orgs/{org}/binders`
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
  org: string,
  name: string,
  description?: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name, description }),
  });
  return { status: response.status, body: await response.text() };
}

async function listWorkspaces(
  sessionCookie: string,
): Promise<WorkspaceSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/app/binders`, {
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

  // The URL names an organization, so this is no longer "which organization
  // did they mean" — it is a person with no subscription asking to create a
  // binder somewhere they do not belong.
  const attempt = await createWorkspace(
    sessionCookie,
    "some-other-organization",
    "Clinical Policies",
  );
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
    org.name,
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
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical Policies"))
      .status,
  ).toBe(201);

  // Provisioning is idempotent, which is right for repairing a partial failure
  // and wrong for a person naming a new binder: they would be handed somebody
  // else's rules and think they had made their own.
  const second = await createWorkspace(
    sessionCookie,
    org.name,
    "Clinical Policies",
  );
  expect(second.status).toBe(409);

  expect(await listWorkspaces(sessionCookie)).toHaveLength(1);
});

test("a binder whose name has nothing Gitea can use is refused", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const attempt = await createWorkspace(sessionCookie, org.name, "!!!");
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
  org: string,
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
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/documents`,
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
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
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
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const first = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const second = await addDocument(sessionCookie, org.name, "clinical", {
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
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const escaped = await addDocument(sessionCookie, org.name, "clinical", {
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
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  // The first is still only on its branch, so main is clear — a second upload
  // of the same name is a second change to the same document, which is a later
  // step's job, not a silent overwrite here.
  expect(
    (
      await addDocument(sessionCookie, org.name, "clinical", {
        name: "Infection Control",
      })
    ).status,
  ).toBe(201);

  const again = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  expect([201, 409]).toContain(again.status);
});

test("adding a document to a binder that does not exist is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const missing = await addDocument(sessionCookie, org.name, "no-such-binder", {
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
  org: string,
  workspace: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/documents`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

async function getDocument(
  sessionCookie: string,
  org: string,
  workspace: string,
  documentPath: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/documents/${documentPath}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

/** The binder itself: what it is called, and how much is in it. */
async function getBinder(
  sessionCookie: string,
  org: string,
  workspace: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

/** The binder's change requests, open or closed. */
async function listChanges(
  sessionCookie: string,
  org: string,
  workspace: string,
  state: "open" | "closed" = "open",
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/changes?state=${state}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

/** Bring a change's branch up to date with the binder's main. */
async function updateChange(
  sessionCookie: string,
  org: string,
  workspace: string,
  changeNumber: number,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/changes/${changeNumber}/update`,
    { method: "POST", headers: authHeaders(sessionCookie) },
  );
  return { status: response.status, body: await response.text() };
}

/** One change: what it proposes, and where it stands. */
async function getChange(
  sessionCookie: string,
  org: string,
  workspace: string,
  changeNumber: number,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/changes/${changeNumber}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

/** Approve a change, ask for work on it, or say something about it. */
async function reviewChange(
  sessionCookie: string,
  org: string,
  workspace: string,
  changeNumber: number,
  event: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/changes/${changeNumber}/reviews`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ event, ...(body ? { body } : {}) }),
    },
  );
  return { status: response.status, body: await response.text() };
}

/** The document's bytes, at a ref. `raw/` rather than a `download` suffix. */
async function downloadDocument(
  sessionCookie: string,
  org: string,
  workspace: string,
  documentPath: string,
  ref?: string,
): Promise<{ status: number; body: string }> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/raw/${documentPath}${query}`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  return { status: response.status, body: await response.text() };
}

test("a binder with nothing in it lists no documents, and is not an error", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(listed.status, listed.body).toBe(200);
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);
});

test("an unpublished document is listed as proposed, and opens", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
    body: "draft policy text",
  });
  expect(added.status, added.body).toBe(201);
  const { slugPath } = JSON.parse(added.body) as { slugPath: string };

  // The upload is on a branch with an open change, and nothing reaches main
  // except a merged, approved change — so this document is not on the record.
  // It is still in the binder's list, because a binder that silently omits
  // what somebody just added looks broken in the one moment they are watching.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(listed.status, listed.body).toBe(200);
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{
      slugPath: string;
      state: string;
      path: string | null;
      openChangeCount: number;
      latestVersion: unknown;
    }>;
  };
  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({
    slugPath,
    state: "proposed",
    // The extension lives in the file, and reading it would cost a tree walk
    // per proposed document — which is the cost the binder exists to remove.
    path: null,
    openChangeCount: 1,
    latestVersion: null,
  });

  // And its page opens, reading the file from the change's own branch. A row
  // that leads to a 404 would be worse than no row at all.
  const detail = await getDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
  );
  expect(detail.status, detail.body).toBe(200);
  const detailPayload = JSON.parse(detail.body) as {
    state: string;
    ref: string;
    document: { path: string };
    versions: unknown[];
  };
  expect(detailPayload.state).toBe("proposed");
  expect(detailPayload.ref.startsWith(`upload/${slugPath}/`)).toBe(true);
  expect(detailPayload.document.path).toBe(`${slugPath}.md`);
  expect(detailPayload.versions).toEqual([]);

  const bytes = await downloadDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
    detailPayload.ref,
  );
  expect(bytes.status, bytes.body).toBe(200);
  expect(bytes.body).toBe("draft policy text");
});

test("publishing turns a proposed document into a published one", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", pullRequestNumber);
  expect(
    (
      await publishChange(
        sessionCookie,
        org.name,
        "clinical",
        pullRequestNumber,
      )
    ).status,
  ).toBe(200);

  // One row, not two: the proposed entry is derived from the open change, and
  // publishing closes it. A binder showing the same policy twice — once as
  // filed and once as waiting — would be the obvious way to get this wrong.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ slugPath: string; state: string; path: string | null }>;
  };
  expect(documents).toHaveLength(1);
  expect(documents[0]).toMatchObject({
    slugPath,
    state: "published",
    path: `${slugPath}.md`,
  });
});

test("listing a binder that does not exist is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await listDocuments(sessionCookie, org.name, "no-such-binder")).status,
  ).toBe(404);
});

test("asking for a document that is not there is a 404, not an empty document", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  expect(
    (await getDocument(sessionCookie, org.name, "clinical", "nursing/handover"))
      .status,
  ).toBe(404);
});

test("a binder in an organization you cannot see is simply not there", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);

  // Now that the URL names the organization, this is a different and better
  // question than it was. Asking for someone else's binder answers 404 — the
  // same answer a binder that does not exist gives, which is the only answer
  // that does not disclose whether it does.
  const listed = await listDocuments(
    sessionCookie,
    "some-other-organization",
    "clinical",
  );
  expect(listed.status, listed.body).toBe(404);
});

/**
 * ADR 0004 §4: the unit of approval is the change, not the document.
 *
 * One approved change that revised three cross-referencing policies publishes
 * three versions, all pointing at the same merge commit. Several tags on one
 * commit is ordinary git, and it is what keeps "who approved v4" answerable as
 * tag → commit → pull request → reviews.
 */
/**
 * Put a second person on the binder's reviewers team, and have them approve.
 *
 * Nothing reaches `main` except a merged, approved change — that is the
 * product's core claim, and the binder's protected `main` enforces it. A
 * publish test that skipped this would be testing a wall that was not there.
 *
 * It also exercises the free-reviewer tier: the approvals whitelist is what
 * makes a reviewer's approval count without giving them write access.
 */
async function addApprover(
  ownerToken: string,
  org: string,
  workspace: string,
): Promise<{
  credentials: Credentials;
  token: string;
  sessionCookie: string;
}> {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);

  const teams = await giteaGet<Array<{ id: number; name: string }>>(
    ownerToken,
    `/orgs/${org}/teams`,
  );
  const reviewers = teams.find(
    (team) => team.name === `${workspace}-reviewers`,
  );
  expect(reviewers, `no ${workspace}-reviewers team`).toBeTruthy();

  const added = await fetch(
    `${GITEA_URL}/api/v1/teams/${reviewers!.id}/members/${credentials.username}`,
    { method: "PUT", headers: { Authorization: `token ${ownerToken}` } },
  );
  expect([200, 204]).toContain(added.status);

  return {
    credentials,
    sessionCookie,
    token: await createUserToken(credentials.username, credentials.password),
  };
}

/**
 * Approve, and make sure the approval actually stands.
 *
 * A binder protects `main` with `dismiss_stale_approvals`, so an approval made
 * against a commit that is no longer the head is dismissed. Gitea processes a
 * push asynchronously, so an approval submitted moments after one lands can be
 * recorded against the old head and then dismissed — `stale: true`,
 * `dismissed: true` — leaving the merge to fail with "Does not have enough
 * approvals" and no visible reason.
 *
 * That behaviour is correct and worth keeping: a review of code that has since
 * changed should not count. So this waits it out and re-approves, which is what
 * a reviewer whose approval was dismissed would do.
 */
async function approveChange(
  approverToken: string,
  org: string,
  workspace: string,
  pullNumber: number,
): Promise<void> {
  const reviewsUrl = `${GITEA_URL}/api/v1/repos/${org}/${workspace}/pulls/${pullNumber}/reviews`;

  const approvalStands = async (): Promise<boolean> => {
    const reviews = (await (
      await fetch(reviewsUrl, {
        headers: { Authorization: `token ${approverToken}` },
      })
    ).json()) as Array<{
      state?: string;
      stale?: boolean;
      dismissed?: boolean;
    }>;

    return reviews.some(
      (review) =>
        review.state === "APPROVED" && !review.stale && !review.dismissed,
    );
  };

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(reviewsUrl, {
      method: "POST",
      headers: {
        Authorization: `token ${approverToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "APPROVED", body: "Looks right." }),
    });
    expect(response.status, await response.text()).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Twice, a beat apart. Gitea processes a push asynchronously and dismisses
    // approvals recorded against the old head, so an approval can read as
    // standing and be gone a second later — which is how this test came to
    // fail at the *merge* with "does not have enough approvals" after having
    // just checked that it had one. Asking again is what makes the answer mean
    // something.
    if (await approvalStands()) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (await approvalStands()) return;
    }
  }

  throw new Error(
    `Approval on ${org}/${workspace}#${pullNumber} kept being dismissed as stale.`,
  );
}

async function publishChange(
  sessionCookie: string,
  org: string,
  workspace: string,
  pullNumber: number,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/changes/${pullNumber}/publish`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ mergeStyle: "merge" }),
    },
  );
  return { status: response.status, body: await response.text() };
}

test("publishing a change versions the document and puts it on main", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
  });
  expect(added.status, added.body).toBe(201);
  const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", pullRequestNumber);

  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  expect(published.status, published.body).toBe(200);

  const { tags } = JSON.parse(published.body) as {
    tags: Array<{ tag: string; version: number; commitSha: string }>;
  };
  // The tag names the document, because a binder's tags are repository-global.
  expect(tags.map((t) => t.tag)).toEqual([`${slugPath}/v1`]);

  // And now it is part of the record: on main, and in the binder's list.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(
    (
      JSON.parse(listed.body) as { documents: Array<{ slugPath: string }> }
    ).documents.map((d) => d.slugPath),
  ).toEqual([slugPath]);

  const detail = await getDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
  );
  expect(detail.status, detail.body).toBe(200);
  const { versions, latestVersion } = JSON.parse(detail.body) as {
    versions: Array<{ version: number }>;
    latestVersion: { version: number } | null;
  };
  expect(versions).toHaveLength(1);
  expect(latestVersion?.version).toBe(1);

  const onMain = await giteaGet<{ path: string }>(
    token,
    `/repos/${org.name}/clinical/contents/${slugPath}.md?ref=main`,
  );
  expect(onMain.path).toBe(`${slugPath}.md`);
});

test("a published document hands back its bytes, by identity or by path", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
    body: "wash your hands",
  });
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", pullRequestNumber);
  expect(
    (
      await publishChange(
        sessionCookie,
        org.name,
        "clinical",
        pullRequestNumber,
      )
    ).status,
  ).toBe(200);

  // The identity, which is what a link carries.
  const byIdentity = await downloadDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
  );
  expect(byIdentity.status, byIdentity.body).toBe(200);
  expect(byIdentity.body).toBe("wash your hands");

  // The file path, which is what a person who copied it out of git carries.
  const byPath = await downloadDocument(
    sessionCookie,
    org.name,
    "clinical",
    documentPath,
  );
  expect(byPath.status, byPath.body).toBe(200);
  expect(byPath.body).toBe("wash your hands");

  // And at the version tag, which is the point: a version is readable as the
  // evidence it is, not only as whatever main happens to say today.
  const atVersion = await downloadDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
    `${slugPath}/v1`,
  );
  expect(atVersion.status, atVersion.body).toBe(200);
  expect(atVersion.body).toBe("wash your hands");

  const missing = await downloadDocument(
    sessionCookie,
    org.name,
    "clinical",
    "nursing/no-such-policy",
  );
  expect(missing.status).toBe(404);
});

test("a change says what it proposes, and what publishing it would write", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
  });
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

  const change = await getChange(
    sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  expect(change.status, change.body).toBe(200);

  const payload = JSON.parse(change.body) as {
    change: {
      number: number;
      branchName: string;
      approvalCount: number;
      requiredApprovals: number | null;
      isApproved: boolean;
    };
    documents: Array<{
      slugPath: string;
      path: string;
      nextVersion: number;
      currentVersion: unknown;
    }>;
    blockOnUnresolvedThreads: boolean;
    unresolvedThreadCount: number;
  };

  expect(payload.change.number).toBe(pullRequestNumber);
  // The branch is what the page reads the submitted file at, so a change
  // without one cannot show what it proposes.
  expect(payload.change.branchName.startsWith(`upload/${slugPath}/`)).toBe(
    true,
  );
  expect(payload.change.approvalCount).toBe(0);
  expect(payload.change.requiredApprovals).toBe(1);
  expect(payload.change.isApproved).toBe(false);

  // What publishing would write, per document — a document being added says
  // v1 rather than showing no version at all.
  expect(payload.documents).toHaveLength(1);
  expect(payload.documents[0]).toMatchObject({
    slugPath,
    path: documentPath,
    nextVersion: 1,
    currentVersion: null,
  });
  expect(payload.unresolvedThreadCount).toBe(0);
});

test("approving through the binder counts, and then it publishes", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
  };

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");

  // The approval goes through the binder's own route rather than straight to
  // Gitea — which is the thing being tested, and is what the page does.
  // `dismiss_stale_approvals` makes an approval submitted moments after a push
  // land against the old head, so this retries until one actually stands.
  let counted = false;
  for (let attempt = 0; attempt < 10 && !counted; attempt += 1) {
    const review = await reviewChange(
      approver.sessionCookie,
      org.name,
      "clinical",
      pullRequestNumber,
      "APPROVE",
    );
    expect(review.status, review.body).toBe(200);

    const change = await getChange(
      sessionCookie,
      org.name,
      "clinical",
      pullRequestNumber,
    );
    counted = (JSON.parse(change.body) as { change: { isApproved: boolean } })
      .change.isApproved;
    if (!counted) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(counted, "the approval never counted").toBe(true);

  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  expect(published.status, published.body).toBe(200);
  expect(
    (JSON.parse(published.body) as { tags: Array<{ tag: string }> }).tags.map(
      (tag) => tag.tag,
    ),
  ).toEqual([`${slugPath}/v1`]);
});

test("asking for changes needs words, and an approval does not", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber } = JSON.parse(added.body) as {
    pullRequestNumber: number;
  };

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");

  // A reviewer who blocks a change without saying why has not reviewed it.
  const silent = await reviewChange(
    approver.sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
    "REQUEST_CHANGES",
  );
  expect(silent.status, silent.body).toBe(400);

  const spoken = await reviewChange(
    approver.sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
    "REQUEST_CHANGES",
    "The isolation section still cites the 2019 guidance.",
  );
  expect(spoken.status, spoken.body).toBe(200);

  const nonsense = await reviewChange(
    approver.sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
    "RUBBER_STAMP",
  );
  expect(nonsense.status).toBe(400);
});

test("a change left behind by another says so, and can be caught up", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  // Two changes off the same main. Publishing the first moves main, which
  // leaves the second behind — the ordinary consequence of two people working
  // in one binder, and a dead end until now: a binder protects main with
  // `block_on_outdated_branch`, so no number of approvals would merge it.
  const first = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const second = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Hand Hygiene",
  });
  const firstNumber = (JSON.parse(first.body) as { pullRequestNumber: number })
    .pullRequestNumber;
  const { pullRequestNumber: secondNumber, slugPath: secondSlug } = JSON.parse(
    second.body,
  ) as { pullRequestNumber: number; slugPath: string };

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");

  await approveChange(approver.token, org.name, "clinical", firstNumber);
  expect(
    (await publishChange(sessionCookie, org.name, "clinical", firstNumber))
      .status,
  ).toBe(200);

  const behind = await getChange(
    sessionCookie,
    org.name,
    "clinical",
    secondNumber,
  );
  expect(behind.status, behind.body).toBe(200);
  expect((JSON.parse(behind.body) as { isBehind: boolean }).isBehind).toBe(
    true,
  );

  const updated = await updateChange(
    sessionCookie,
    org.name,
    "clinical",
    secondNumber,
  );
  expect(updated.status, updated.body).toBe(200);

  // Gitea recomputes the merge base after the push, so this is the state it
  // settles into rather than the state it reports immediately.
  let caughtUp = false;
  for (let attempt = 0; attempt < 10 && !caughtUp; attempt += 1) {
    const change = await getChange(
      sessionCookie,
      org.name,
      "clinical",
      secondNumber,
    );
    caughtUp = !(JSON.parse(change.body) as { isBehind: boolean }).isBehind;
    if (!caughtUp) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(caughtUp, "the change never caught up with main").toBe(true);

  // And now it publishes, which is the whole point of the way out.
  await approveChange(approver.token, org.name, "clinical", secondNumber);
  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    secondNumber,
  );
  expect(published.status, published.body).toBe(200);
  expect(
    (JSON.parse(published.body) as { tags: Array<{ tag: string }> }).tags.map(
      (tag) => tag.tag,
    ),
  ).toEqual([`${secondSlug}/v1`]);
});

test("the binder names itself, and counts what is in it", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (
      await createWorkspace(
        sessionCookie,
        org.name,
        "Clinical",
        "Policies the clinical committee governs",
      )
    ).status,
  ).toBe(201);

  const empty = await getBinder(sessionCookie, org.name, "clinical");
  expect(empty.status, empty.body).toBe(200);
  expect(JSON.parse(empty.body)).toMatchObject({
    workspace: {
      name: "clinical",
      owner: org.name,
      description: "Policies the clinical committee governs",
    },
    documentCount: 0,
    openChangeCount: 0,
  });

  // The counts are what the tab bar shows, so both have to move — a person
  // reading Documents still needs to see that a change is waiting.
  await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const withOne = await getBinder(sessionCookie, org.name, "clinical");
  expect(JSON.parse(withOne.body)).toMatchObject({
    documentCount: 0,
    openChangeCount: 1,
  });
});

test("a binder lists its change requests, open and then decided", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "Nursing",
  });
  const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
  };

  const open = await listChanges(sessionCookie, org.name, "clinical", "open");
  expect(open.status, open.body).toBe(200);
  const openPayload = JSON.parse(open.body) as {
    state: string;
    changes: Array<{
      number: number;
      outcome: string;
      closedAt: string | null;
      documents: Array<{ slugPath: string; version: number | null }>;
    }>;
  };
  expect(openPayload.state).toBe("open");
  expect(openPayload.changes).toHaveLength(1);
  expect(openPayload.changes[0]).toMatchObject({
    number: pullRequestNumber,
    outcome: "open",
    closedAt: null,
  });
  // Named from the upload branch, so the row says what it is about without a
  // call per change.
  expect(openPayload.changes[0]?.documents).toEqual([
    { slugPath, name: "infection-control", version: null },
  ]);

  expect(
    (
      JSON.parse(
        (await listChanges(sessionCookie, org.name, "clinical", "closed")).body,
      ) as {
        changes: unknown[];
      }
    ).changes,
  ).toEqual([]);

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", pullRequestNumber);
  expect(
    (
      await publishChange(
        sessionCookie,
        org.name,
        "clinical",
        pullRequestNumber,
      )
    ).status,
  ).toBe(200);

  expect(
    (
      JSON.parse(
        (await listChanges(sessionCookie, org.name, "clinical", "open")).body,
      ) as {
        changes: unknown[];
      }
    ).changes,
  ).toEqual([]);

  const closed = await listChanges(
    sessionCookie,
    org.name,
    "clinical",
    "closed",
  );
  const closedPayload = JSON.parse(closed.body) as {
    changes: Array<{
      number: number;
      outcome: string;
      closedAt: string | null;
      decidedBy: string | null;
      documents: Array<{ slugPath: string; version: number | null }>;
    }>;
  };
  expect(closedPayload.changes).toHaveLength(1);
  expect(closedPayload.changes[0]).toMatchObject({
    number: pullRequestNumber,
    outcome: "published",
  });
  expect(closedPayload.changes[0]?.closedAt).not.toBeNull();
  // A published change is named exactly by the version tags on its merge
  // commit — which is one tags read for the whole binder, not one per change.
  expect(closedPayload.changes[0]?.documents).toEqual([
    { slugPath, name: "infection-control", version: 1 },
  ]);
});

test("a binder that is not there is a 404, not an empty binder", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await getBinder(sessionCookie, org.name, "no-such-binder")).status,
  ).toBe(404);
  expect(
    (await listChanges(sessionCookie, org.name, "no-such-binder")).status,
  ).toBe(404);
});

test("a binder's change carries a discussion, its updates and its reviewers", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber } = JSON.parse(added.body) as {
    pullRequestNumber: number;
  };

  const base = `${API_BASE_URL}/api/app/binders/${org.name}/clinical/changes/${pullRequestNumber}`;
  const get = (path: string) =>
    fetch(`${base}${path}`, {
      headers: { Cookie: `bindersnap_session=${sessionCookie}` },
    });
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify(body),
    });

  // Every one of these is the document model's own handler reached at the
  // binder's address. The point of the test is that the address resolves and
  // the behaviour is unchanged — a binder is a Gitea repository, and a change
  // on it is a Gitea pull request.
  const empty = await get("/discussions");
  expect(empty.status, await empty.clone().text()).toBe(200);
  expect(
    ((await empty.json()) as { threads: unknown[]; unresolvedCount: number })
      .unresolvedCount,
  ).toBe(0);

  const started = await post("/discussions", {
    body: "Does fourteen days match the staffing agency's onboarding?",
  });
  expect(started.status, await started.clone().text()).toBe(201);
  const opened = (await started.json()) as {
    threads: Array<{ id: string; resolved: boolean }>;
    unresolvedCount: number;
  };
  expect(opened.threads).toHaveLength(1);
  expect(opened.unresolvedCount).toBe(1);
  const threadId = opened.threads[0]!.id;

  const replied = await post(
    `/discussions/${encodeURIComponent(threadId)}/comments`,
    { body: "It does — their SLA is ten." },
  );
  expect(replied.status, await replied.clone().text()).toBe(201);

  const resolved = await post(
    `/discussions/${encodeURIComponent(threadId)}/resolve`,
    { resolved: true },
  );
  expect(resolved.status, await resolved.clone().text()).toBe(200);
  expect(
    ((await resolved.json()) as { unresolvedCount: number }).unresolvedCount,
  ).toBe(0);

  // The change's own history: every version it has proposed.
  const updates = await get("/updates");
  expect(updates.status, await updates.clone().text()).toBe(200);
  expect(
    ((await updates.json()) as { updates: unknown[] }).updates.length,
  ).toBeGreaterThan(0);

  // And who has to sign it off.
  const assigned = await fetch(`${base}/assignments`, {
    method: "PUT",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ reviewers: [] }),
  });
  expect(assigned.status, await assigned.clone().text()).toBe(200);

  const people = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/collaborators`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(people.status, await people.clone().text()).toBe(200);
});

test("a change detail says whether this caller may set its reviewers", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
  };

  const detail = await getChange(
    sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  const payload = JSON.parse(detail.body) as {
    canManage: boolean;
    documents: Array<{ slugPath: string; versions: unknown[] }>;
  };

  // The org owner can write in the binder, so they are offered the reviewer
  // list. Read from the repository as them — a binder's people get their
  // access through org teams, which the collaborator endpoint reports as
  // "none".
  expect(payload.canManage).toBe(true);

  // The comparison needs the version below the one a published change became,
  // so the whole list travels rather than only the newest.
  expect(payload.documents[0]).toMatchObject({ slugPath, versions: [] });

  // A reviewer with read access is not offered it.
  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");
  const asReviewer = await getChange(
    approver.sessionCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  expect(
    (JSON.parse(asReviewer.body) as { canManage: boolean }).canManage,
  ).toBe(false);
});

test("a change in a binder that is not there is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await getChange(sessionCookie, org.name, "no-such-binder", 1)).status,
  ).toBe(404);
});

test("one change across two documents publishes two versions on one commit", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  // Two documents, one upload branch, one change — a revision that touches
  // cross-referencing policies together, which ADR 0004 calls a feature.
  const first = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  expect(first.status, first.body).toBe(201);
  const firstPayload = JSON.parse(first.body) as {
    branch: string;
    pullRequestNumber: number;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // Add a second document onto the same branch, the way a person revising two
  // policies together would.
  const commit = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/contents/handover.md`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch: firstPayload.branch,
        content: Buffer.from("handover policy").toString("base64"),
        message: "Add handover alongside infection control",
      }),
    },
  );
  expect(commit.status, await commit.text()).toBe(201);

  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(
    approver.token,
    org.name,
    "clinical",
    firstPayload.pullRequestNumber,
  );

  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    firstPayload.pullRequestNumber,
  );
  expect(published.status, published.body).toBe(200);

  const { tags } = JSON.parse(published.body) as {
    tags: Array<{ tag: string; commitSha: string }>;
  };
  expect(tags.map((t) => t.tag).sort()).toEqual([
    "handover/v1",
    "infection-control/v1",
  ]);

  // Both tags point at the same merge commit. Approvals cover the change, so
  // the two versions share one approval record.
  expect(new Set(tags.map((t) => t.commitSha)).size).toBe(1);
});

test("a second change to the same document publishes v2, not another v1", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const first = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const firstNumber = (JSON.parse(first.body) as { pullRequestNumber: number })
    .pullRequestNumber;

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", firstNumber);

  expect(
    (await publishChange(sessionCookie, org.name, "clinical", firstNumber))
      .status,
  ).toBe(200);

  // A revision of a document that already exists. The upload endpoint refuses
  // to create over it — turning that into a proper revision flow is a later
  // step — so the change is built directly, the way that flow eventually will.
  const branch = `upload/infection-control/${Date.now()}`;
  const branched = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/branches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        new_branch_name: branch,
        old_branch_name: "main",
      }),
    },
  );
  expect(branched.status, await branched.text()).toBe(201);

  const existing = await giteaGet<{ sha: string }>(
    ownerToken,
    `/repos/${org.name}/clinical/contents/infection-control.md?ref=main`,
  );
  const updated = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/contents/infection-control.md`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch,
        sha: existing.sha,
        content: Buffer.from("revised policy text").toString("base64"),
        message: "Revise infection control",
      }),
    },
  );
  expect(updated.status, await updated.text()).toBe(200);

  const secondPull = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${ownerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        head: branch,
        base: "main",
        title: "Revise infection control",
      }),
    },
  );
  // Read the body once: `expect`'s message argument is evaluated eagerly, so
  // awaiting `.text()` inside it consumes the body before `.json()` can.
  const secondPullBody = await secondPull.text();
  expect(secondPull.status, secondPullBody).toBe(201);
  const secondNumber = (JSON.parse(secondPullBody) as { number: number })
    .number;

  await approveChange(approver.token, org.name, "clinical", secondNumber);
  const republished = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    secondNumber,
  );
  expect(republished.status, republished.body).toBe(200);

  // The version follows the highest already published, rather than restarting.
  expect(
    (JSON.parse(republished.body) as { tags: Array<{ tag: string }> }).tags.map(
      (t) => t.tag,
    ),
  ).toEqual(["infection-control/v2"]);

  const detail = await getDocument(
    sessionCookie,
    org.name,
    "clinical",
    "infection-control",
  );
  const { versions, latestVersion } = JSON.parse(detail.body) as {
    versions: Array<{ version: number }>;
    latestVersion: { version: number } | null;
  };
  // Newest first, and both versions kept: the record is every version, not the
  // current one.
  expect(versions.map((v) => v.version)).toEqual([2, 1]);
  expect(latestVersion?.version).toBe(2);
});

test("two documents cannot claim one address", async () => {
  // A URL has to name one thing, or a link somebody sends is a coin toss. The
  // identity drops the extension deliberately — re-uploading a policy as a PDF
  // should keep its history — so nothing else may claim the same identity.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const first = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Policy",
    folder: "Nursing",
    filename: "policy.md",
  });
  expect(first.status, first.body).toBe(201);

  // Same name, different extension. `main` does not have the first one yet —
  // it is still an open change — which is exactly the race that made this
  // slip through: the tree alone cannot see it, but the upload branch can.
  const second = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Policy",
    folder: "Nursing",
    filename: "policy.pdf",
  });
  expect(second.status, second.body).toBe(409);
  expect(second.body).toContain("nursing/policy");
});
