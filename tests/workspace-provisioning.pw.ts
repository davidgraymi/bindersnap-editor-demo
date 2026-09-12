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

import { isDocumentUid } from "../packages/utils/documentUid";
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
  /** Whether the whole organization can read it. Open is the product default. */
  openToOrganization?: boolean,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({
      name,
      description,
      ...(openToOrganization === undefined ? {} : { openToOrganization }),
    }),
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

  // The organization's own teams, and only those: a binder manufactures none.
  // In Gitea a team is an organization object that a repository adopts, so
  // three per binder inverts the model and makes a recurring group
  // un-reusable — a Quality Committee reviewing three binders would be three
  // membership lists kept in step by hand.
  const teams = await giteaGet<Array<{ name: string }>>(
    token,
    `/orgs/${org.name}/teams`,
  );
  expect(teams.map((team) => team.name).sort()).toEqual(["Owners", "staff"]);

  const protection = await giteaGet<{
    enable_push: boolean;
    required_approvals: number;
    enable_approvals_whitelist: boolean;
    approvals_whitelist_teams: string[];
    block_on_official_review_requests: boolean;
    block_on_codeowner_reviews?: boolean;
  }>(token, `/repos/${org.name}/clinical-policies/branch_protections/main`);

  // Nothing reaches main except a merged, approved change.
  expect(protection.enable_push).toBe(false);
  expect(protection.required_approvals).toBeGreaterThan(0);

  // And the field the free-reviewer tier lives or dies on: without it Gitea
  // resolves "official reviewer" as "has write access", which would make every
  // reviewer's approval count for nothing.
  expect(protection.enable_approvals_whitelist).toBe(true);
  // `staff`, because the binder is open to the organization — and `Owners`,
  // which is never granted onto a repository at all. Gitea gives it admin over
  // the whole organization implicitly, so a whitelist derived from the granted
  // teams alone would omit it and an owner's approval would silently stop
  // counting.
  expect(protection.approvals_whitelist_teams.sort()).toEqual([
    "Owners",
    "staff",
  ]);
  // **The two gates, and which one is on depends on the Gitea underneath.**
  // `block_on_codeowner_reviews` (28.0.0) is the per-folder gate that actually
  // enforces a sign-off rule and lets it name a team. `block_on_official_review_requests`
  // (1.27) was only ever on to make CODEOWNERS block, which it never did for a
  // team code owner — and left on beside the new gate it blocks on *manually*
  // requested reviews, so any member could stall a publish by requesting one.
  //
  // Provisioning writes the new field and reads the protection back to see
  // whether it stuck, because a Gitea that does not have it accepts the write
  // and silently drops it. So exactly one of these is true, and which one is
  // the honest answer to "what version is this stack on".
  if (protection.block_on_codeowner_reviews) {
    expect(protection.block_on_official_review_requests).toBe(false);
  } else {
    // The 1.27 path: the older gate stays on, because it is then the only
    // per-folder enforcement the binder has and turning it off would put
    // nothing in its place.
    expect(protection.block_on_official_review_requests).toBe(true);
  }
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
  fields: {
    name: string;
    folder?: string;
    filename?: string;
    body?: string;
    /** An open change to put it in, instead of opening one of its own. */
    changeNumber?: number;
  },
): Promise<{ status: number; body: string }> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([fields.body ?? "policy text"], { type: "text/markdown" }),
    fields.filename ?? "policy.md",
  );
  form.set("name", fields.name);
  if (fields.folder) form.set("folder", fields.folder);
  if (fields.changeNumber !== undefined) {
    form.set("changeNumber", String(fields.changeNumber));
  }

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

/**
 * The identity the server minted, read back out of the filename it returned.
 *
 * Tests assert on it rather than hard-coding one, because it is minted per
 * upload and only the server knows it (ADR 0005). `documentPath` is the one
 * place a caller ever sees it.
 */
function uidOf(documentPath: string): string {
  const uid = documentPath.split(".").find(isDocumentUid);
  expect(uid, `no identity segment in "${documentPath}"`).toBeDefined();
  return uid!;
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
  // The address is what a person typed; the filename also carries the identity
  // minted for the document (ADR 0005), which is what its version tags will be
  // named after for the rest of its life.
  expect(payload.slugPath).toBe("nursing/infection-control");
  expect(payload.documentPath).toMatch(
    /^nursing\/infection-control\.[0-9A-HJKMNP-TV-Z]{26}\.md$/,
  );
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
  ).toMatch(/^etc\/escape\.[0-9A-HJKMNP-TV-Z]{26}\.md$/);
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

test("an unpublished document is not in the binder, and still opens", async () => {
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
  const { slugPath, documentPath } = JSON.parse(added.body) as {
    slugPath: string;
    documentPath: string;
  };

  // The upload is on a branch with an open change, and nothing reaches main
  // except a merged, approved change — so this document is not on the record,
  // and **a binder lists the record**. A list whose job is to answer "what is
  // in force here" must not mix in things that are not.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(listed.status, listed.body).toBe(200);
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ slugPath: string }>;
  };
  expect(documents).toEqual([]);

  // It is not lost, though: it is a change request, and the binder has one.
  const changes = await listChanges(
    sessionCookie,
    org.name,
    "clinical",
    "open",
  );
  expect(changes.status, changes.body).toBe(200);
  expect(
    (JSON.parse(changes.body) as { changes: unknown[] }).changes,
  ).toHaveLength(1);

  // And its own page opens, reading the file from the change's branch. A link
  // into a policy that is in review has to resolve — that is a different
  // surface from a list of what is in force.
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
  expect(detailPayload.document.path).toBe(documentPath);
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
    path: documentPath,
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
 * Put a second person in the organization's `staff` team, so they can approve.
 *
 * Nothing reaches `main` except a merged, approved change — that is the
 * product's core claim, and the binder's protected `main` enforces it. A
 * publish test that skipped this would be testing a wall that was not there.
 *
 * It also exercises the free-reviewer tier twice over: `staff` holds read on
 * `repo.code` and `repo.pulls`, which is the whole cost of reviewing, and the
 * approvals whitelist is what makes that approval count.
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

  // Through `staff`, the organization's own read team, which a new binder is
  // granted because it is open to the organization. There is no
  // `<binder>-reviewers` to join: a binder manufactures no teams, and the
  // per-binder one is created lazily on the first *individual* grant.
  const teams = await giteaGet<Array<{ id: number; name: string }>>(
    ownerToken,
    `/orgs/${org}/teams`,
  );
  const staff = teams.find((team) => team.name === "staff");
  expect(staff, `no staff team in ${org}`).toBeTruthy();

  const added = await fetch(
    `${GITEA_URL}/api/v1/teams/${staff!.id}/members/${credentials.username}`,
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
  // The tag names the document by its identity, because a binder's tags are
  // repository-global and because a rename must not restart the numbering.
  expect(tags.map((t) => t.tag)).toEqual([`${uidOf(documentPath)}/v1`]);

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
    `/repos/${org.name}/clinical/contents/${documentPath}?ref=main`,
  );
  expect(onMain.path).toBe(documentPath);
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
    `${uidOf(documentPath)}/v1`,
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
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
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
  const stillApproved = async (): Promise<boolean> => {
    const change = await getChange(
      sessionCookie,
      org.name,
      "clinical",
      pullRequestNumber,
    );
    return (JSON.parse(change.body) as { change: { isApproved: boolean } })
      .change.isApproved;
  };

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

    // Twice, a beat apart, the same rule `approveChange` uses. Gitea processes
    // a push asynchronously and marks approvals against the old head stale a
    // moment later, so an approval can read as standing and be gone by the time
    // the merge is attempted — which is how this test failed at the *publish*
    // with "does not have enough approvals" after checking it had one.
    if (await stillApproved()) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      counted = await stillApproved();
    }
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
  ).toEqual([`${uidOf(documentPath)}/v1`]);
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
  const { pullRequestNumber: secondNumber, documentPath: secondPath } =
    JSON.parse(second.body) as {
      pullRequestNumber: number;
      documentPath: string;
    };

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
  ).toEqual([`${uidOf(secondPath)}/v1`]);
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
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
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
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
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

test("the binder's history answers who approved which version", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const history = (url: string) =>
    fetch(url, { headers: { Cookie: `bindersnap_session=${sessionCookie}` } });
  const historyUrl = `${API_BASE_URL}/api/app/binders/${org.name}/clinical/history`;

  // A binder nobody has published in has no history, which is a state.
  const empty = await history(historyUrl);
  expect(empty.status, await empty.clone().text()).toBe(200);
  expect(((await empty.json()) as { versions: unknown[] }).versions).toEqual(
    [],
  );

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

  const published = await history(historyUrl);
  const payload = (await published.json()) as {
    versions: Array<{
      slugPath: string;
      name: string;
      folder: string;
      version: number;
      publishedAt: string;
      changeNumber: number | null;
      submittedBy: string;
      approvers: string[];
    }>;
  };

  expect(payload.versions).toHaveLength(1);
  // ADR 0004: "who approved v4 of infection control" is tag → commit → pull
  // request → reviews, and "the record is exact". This is that chain.
  expect(payload.versions[0]).toMatchObject({
    slugPath,
    name: "infection-control",
    folder: "nursing",
    version: 1,
    changeNumber: pullRequestNumber,
    submittedBy: credentials.username,
    approvers: [approver.credentials.username],
  });
  expect(payload.versions[0]?.publishedAt).not.toBe("");
});

test("the binder says who can act in it, and the rules it is under", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(ownerToken, org.name, "clinical");

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/settings`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const payload = (await response.json()) as {
    teams: Array<{
      name: string;
      access: string;
      members: Array<{ login: string }>;
    }>;
    rules: {
      requiredApprovals: number | null;
      dismissStaleApprovals: boolean;
      pushBlocked: boolean;
      blockOnUnresolvedThreads: boolean;
    };
    canManage: boolean;
  };

  // The rule that is the product's whole claim, readable by a member rather
  // than only by a repository admin — the count is policy everyone reviewing
  // is entitled to, so it is read with the service account.
  expect(payload.rules.pushBlocked).toBe(true);
  expect(payload.rules.requiredApprovals).toBe(1);
  expect(payload.rules.dismissStaleApprovals).toBe(true);

  // The teams granted onto the repository, asked of the repository — a binder's
  // people reach it through org teams, which no name convention can be trusted
  // to enumerate. A new binder is granted exactly one: the organization's own
  // `staff`, because it is open to the organization.
  const staff = payload.teams.find((team) => team.name === "staff");
  expect(staff, JSON.stringify(payload.teams)).toBeTruthy();
  // Read on repo.code is what ADR 0004 promises is free forever.
  expect(staff!.access).toBe("read");
  expect(staff!.members.map((member) => member.login)).toContain(
    approver.credentials.username,
  );

  // ADR 0004 warns that the Owners team is easy to miss: its members have
  // access to every repository the organization holds, and Gitea reports that
  // as `repo.code: "owner"` rather than as write or admin. A binder's people
  // page that did not know the level called it "no access", beside the person
  // who owns the organization.
  const owners = payload.teams.find((team) => team.name === "Owners");
  expect(owners, JSON.stringify(payload.teams)).toBeTruthy();
  expect(owners!.access).toBe("owner");
  expect(owners!.members.map((member) => member.login)).toContain(
    credentials.username,
  );

  expect(payload.canManage).toBe(true);
});

test("history and settings on a binder that is not there are 404s", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  for (const path of ["history", "settings"]) {
    const response = await fetch(
      `${API_BASE_URL}/api/app/binders/${org.name}/no-such-binder/${path}`,
      { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
    );
    expect(response.status, path).toBe(404);
  }
});

test("a new binder makes no role teams, and opens to the whole staff", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/settings`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  const payload = (await response.json()) as {
    teams: Array<{ name: string; access: string }>;
  };
  const names = payload.teams.map((team) => team.name).sort();

  // In Gitea a team is an organization object that a repository adopts, so
  // three teams per binder inverts the model — two stay empty forever, and a
  // group reviewing three binders becomes three lists kept in step by hand.
  expect(names).not.toContain("clinical-admins");
  expect(names).not.toContain("clinical-authors");
  expect(names).not.toContain("clinical-reviewers");

  // A new binder is open to the organization, which is the decided default:
  // the common case is a manual everybody must read in order to attest to it.
  const staff = payload.teams.find((team) => team.name === "staff");
  expect(staff, JSON.stringify(payload.teams)).toBeTruthy();
  // Read, so it costs no seats — a seat is write or better on `repo.code`.
  expect(staff!.access).toBe("read");
});

test("an owner's approval counts, although Owners is never granted", async () => {
  // The sharpest failure in this design and a silent one. `Owners` is never
  // granted onto a repository — Gitea gives it admin over the whole
  // organization implicitly — so a whitelist derived from the granted teams
  // alone omits it, and an owner's approval is recorded, displayed, and
  // satisfies nothing. It presents as "publishing is mysteriously blocked".
  const author = buildCredentials();
  const authorCookie = await signUp(author);
  const org = await createOrganization(authorCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(authorCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(author.username, author.password);

  // A second owner, so somebody other than the submitter can approve. They are
  // in no other team — which is the point of the test.
  const owner = buildCredentials();
  await signUp(owner);
  const teams = await giteaGet<Array<{ id: number; name: string }>>(
    ownerToken,
    `/orgs/${org.name}/teams`,
  );
  const owners = teams.find((team) => team.name === "Owners");
  expect(owners, JSON.stringify(teams)).toBeTruthy();
  const added = await fetch(
    `${GITEA_URL}/api/v1/teams/${owners!.id}/members/${owner.username}`,
    { method: "PUT", headers: { Authorization: `token ${ownerToken}` } },
  );
  expect([200, 204]).toContain(added.status);

  const ownerApproverToken = await createUserToken(
    owner.username,
    owner.password,
  );

  const addedDoc = await addDocument(authorCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber, documentPath } = JSON.parse(addedDoc.body) as {
    pullRequestNumber: number;
    documentPath: string;
  };

  await approveChange(
    ownerApproverToken,
    org.name,
    "clinical",
    pullRequestNumber,
  );

  // If `Owners` were missing from `approvals_whitelist_teams`, this is where it
  // would fail — with "does not have enough approvals" beside a green approval.
  const published = await publishChange(
    authorCookie,
    org.name,
    "clinical",
    pullRequestNumber,
  );
  expect(published.status, published.body).toBe(200);
  expect(
    (JSON.parse(published.body) as { tags: Array<{ tag: string }> }).tags.map(
      (tag) => tag.tag,
    ),
  ).toEqual([`${uidOf(documentPath)}/v1`]);
});

test("a member of staff can approve, and the approval counts", async () => {
  // ADR 0004 promises reviewers are free forever, and `staff` is how the whole
  // organization holds that permission once instead of once per binder. It is
  // only true if `staff` is whitelisted — read on `repo.code` and `repo.pulls`
  // is what approving costs, and the whitelist is what makes it count.
  const author = buildCredentials();
  const authorCookie = await signUp(author);
  const org = await createOrganization(authorCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(authorCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(author.username, author.password);

  const staffMember = buildCredentials();
  await signUp(staffMember);
  const teams = await giteaGet<Array<{ id: number; name: string }>>(
    ownerToken,
    `/orgs/${org.name}/teams`,
  );
  const staff = teams.find((team) => team.name === "staff");
  expect(staff, JSON.stringify(teams)).toBeTruthy();
  const joined = await fetch(
    `${GITEA_URL}/api/v1/teams/${staff!.id}/members/${staffMember.username}`,
    { method: "PUT", headers: { Authorization: `token ${ownerToken}` } },
  );
  expect([200, 204]).toContain(joined.status);

  const addedDoc = await addDocument(authorCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber } = JSON.parse(addedDoc.body) as {
    pullRequestNumber: number;
  };

  await approveChange(
    await createUserToken(staffMember.username, staffMember.password),
    org.name,
    "clinical",
    pullRequestNumber,
  );

  expect(
    (await publishChange(authorCookie, org.name, "clinical", pullRequestNumber))
      .status,
  ).toBe(200);
});

test("the organization says who is in it, and which groups they are in", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org.name}/people`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const payload = (await response.json()) as {
    people: Array<{ login: string; isOwner: boolean; teams: string[] }>;
    groups: Array<{ name: string; access: string; memberCount: number }>;
    canManage: boolean;
  };

  // Two rungs and only two. The creator is the owner Gitea made them.
  expect(payload.people).toHaveLength(1);
  expect(payload.people[0]).toMatchObject({
    login: credentials.username,
    isOwner: true,
  });
  // `staff` is everybody by definition — and now genuinely holds everybody, so
  // it would be on every row — which says nothing and crowds out the groups
  // that do. It is left off deliberately.
  expect(payload.people[0]?.teams).toEqual(["Owners"]);

  // `staff` is left out: it is the organization's membership rather than a
  // group, and the People count above is already the same number.
  expect(payload.groups.map((group) => group.name).sort()).toEqual(["Owners"]);
  expect(payload.canManage).toBe(true);
});

async function createGroup(
  sessionCookie: string,
  org: string,
  name: string,
  level: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/groups`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name, level }),
  });
  return { status: response.status, body: await response.text() };
}

async function addToGroup(
  sessionCookie: string,
  org: string,
  group: string,
  username: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org}/groups/${group}/members`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ username }),
    },
  );
  return { status: response.status, body: await response.text() };
}

async function grantGroup(
  sessionCookie: string,
  org: string,
  workspace: string,
  group: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/groups`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ group }),
    },
  );
  return { status: response.status, body: await response.text() };
}

async function revokeGroup(
  sessionCookie: string,
  org: string,
  workspace: string,
  group: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/groups/${group}`,
    { method: "DELETE", headers: authHeaders(sessionCookie) },
  );
  return { status: response.status, body: await response.text() };
}

/** What Gitea is actually enforcing, asked of Gitea rather than of our reply. */
async function readApprovalsWhitelist(
  ownerToken: string,
  org: string,
  workspace: string,
): Promise<string[]> {
  const protection = await giteaGet<{
    approvals_whitelist_teams?: string[];
    enable_approvals_whitelist?: boolean;
  }>(ownerToken, `/repos/${org}/${workspace}/branch_protections/main`);

  expect(protection.enable_approvals_whitelist).toBe(true);
  return (protection.approvals_whitelist_teams ?? []).slice().sort();
}

test("a group is named and levelled at once, and reaches no binder until it is added", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  // What a customer types, and the handle Gitea can carry. A group's name is
  // written into `.gitea/CODEOWNERS` as `@org/group`, which Gitea parses by
  // splitting on whitespace — so "Quality Committee" could never be named in a
  // sign-off rule, and the handle is the name.
  const created = await createGroup(
    sessionCookie,
    org.name,
    "Quality Committee",
    "reviewer",
  );
  expect(created.status, created.body).toBe(201);
  expect(
    (JSON.parse(created.body) as { group: { name: string } }).group,
  ).toMatchObject({
    name: "quality-committee",
    access: "read",
    memberCount: 0,
  });

  // ADR 0004: "a team granted onto no repository grants access to nothing and
  // costs nothing". Naming a group is free; composing it is a separate act by
  // whoever runs the binder.
  const settings = (await (
    await fetch(
      `${API_BASE_URL}/api/app/binders/${org.name}/clinical/settings`,
      { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
    )
  ).json()) as { teams: Array<{ name: string }> };
  expect(settings.teams.map((team) => team.name)).not.toContain(
    "quality-committee",
  );

  // A second group of the same name is refused rather than silently returning
  // the first, which would hand somebody a group at a level they did not pick.
  const again = await createGroup(
    sessionCookie,
    org.name,
    "quality committee",
    "admin",
  );
  expect(again.status, again.body).toBe(409);
});

test("a member of a granted group can approve, and the approval counts", async () => {
  // The proof for groups, and it is one claim with two halves: the grant gives
  // the access, and the whitelist recompute is what makes the approval mean
  // anything. Without the second, the approval is recorded, displayed, and
  // satisfies nothing — with no error message anywhere.
  const author = buildCredentials();
  const authorCookie = await signUp(author);
  const org = await createOrganization(authorCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(authorCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(author.username, author.password);

  expect(
    (await createGroup(authorCookie, org.name, "Quality Committee", "reviewer"))
      .status,
  ).toBe(201);

  // Somebody who is in no other team: not an owner, and — because the grant is
  // what this test is about — reachable only through the group.
  const reviewer = buildCredentials();
  await signUp(reviewer);
  const joined = await addToGroup(
    authorCookie,
    org.name,
    "quality-committee",
    reviewer.username,
  );
  expect(joined.status, joined.body).toBe(200);
  expect(
    (
      JSON.parse(joined.body) as {
        groups: Array<{ name: string; memberCount: number }>;
      }
    ).groups.find((group) => group.name === "quality-committee")?.memberCount,
  ).toBe(1);

  const granted = await grantGroup(
    authorCookie,
    org.name,
    "clinical",
    "quality-committee",
  );
  expect(granted.status, granted.body).toBe(200);
  const grantedPayload = JSON.parse(granted.body) as {
    teams: Array<{ name: string }>;
    approvalsWhitelist: string[];
  };
  expect(grantedPayload.teams.map((team) => team.name)).toContain(
    "quality-committee",
  );
  // Recomputed in the same call, and containing `Owners` — which Gitea never
  // grants onto a repository, so a list derived from the granted teams alone
  // would omit it and stop counting an owner's approval.
  expect(grantedPayload.approvalsWhitelist.slice().sort()).toEqual([
    "Owners",
    "quality-committee",
    "staff",
  ]);
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners", "quality-committee", "staff"]);

  const addedDoc = await addDocument(authorCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber } = JSON.parse(addedDoc.body) as {
    pullRequestNumber: number;
  };

  await approveChange(
    await createUserToken(reviewer.username, reviewer.password),
    org.name,
    "clinical",
    pullRequestNumber,
  );

  expect(
    (await publishChange(authorCookie, org.name, "clinical", pullRequestNumber))
      .status,
  ).toBe(200);
});

test("revoking a group narrows the approvals whitelist in the same call", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );

  expect(
    (await createGroup(sessionCookie, org.name, "Nursing Leads", "editor"))
      .status,
  ).toBe(201);
  expect(
    (await grantGroup(sessionCookie, org.name, "clinical", "nursing-leads"))
      .status,
  ).toBe(200);
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners", "nursing-leads", "staff"]);

  const revoked = await revokeGroup(
    sessionCookie,
    org.name,
    "clinical",
    "nursing-leads",
  );
  expect(revoked.status, revoked.body).toBe(200);
  const payload = JSON.parse(revoked.body) as {
    teams: Array<{ name: string }>;
    approvalsWhitelist: string[];
  };
  expect(payload.teams.map((team) => team.name)).not.toContain("nursing-leads");
  // Narrowed by the same code path that widened it — a whitelist that only ever
  // grew would leave a revoked group's approvals counting after the access that
  // justified them was taken away.
  expect(payload.approvalsWhitelist.slice().sort()).toEqual([
    "Owners",
    "staff",
  ]);
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners", "staff"]);
});

test("a group says which binders it reaches, from the group's own row", async () => {
  // The binder's Settings tab answers "who can act here". An owner looking at a
  // group is asking the opposite question, and it is the one that decides
  // whether changing the group is safe: its level and its people land on every
  // binder in this list at once. Both are the same grant read from either end.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  expect((await createWorkspace(sessionCookie, org.name, "HR")).status).toBe(
    201,
  );

  expect(
    (
      await createGroup(
        sessionCookie,
        org.name,
        "Quality Committee",
        "reviewer",
      )
    ).status,
  ).toBe(201);

  const readGroups = async (): Promise<
    Array<{ name: string; binders: string[] }>
  > => {
    const response = await fetch(
      `${API_BASE_URL}/api/app/orgs/${org.name}/people`,
      { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
    );
    expect(response.status).toBe(200);
    return (
      (await response.json()) as {
        groups: Array<{ name: string; binders: string[] }>;
        binders: string[];
      }
    ).groups;
  };

  const named = (
    groups: Array<{ name: string; binders: string[] }>,
    name: string,
  ) => groups.find((group) => group.name === name);

  // Named and reaching nothing. ADR 0004: a team granted onto no repository
  // grants access to nothing and costs nothing.
  expect(named(await readGroups(), "quality-committee")?.binders).toEqual([]);

  expect(
    (await grantGroup(sessionCookie, org.name, "clinical", "quality-committee"))
      .status,
  ).toBe(200);
  expect(
    (await grantGroup(sessionCookie, org.name, "hr", "quality-committee"))
      .status,
  ).toBe(200);

  const both = await readGroups();
  expect(named(both, "quality-committee")?.binders).toEqual(["clinical", "hr"]);
  // `staff` is not offered as a group: it is the organization's membership, and
  // its only control is each binder's own "who can see this" switch. A row
  // beside the customer's own committees would make the most consequential
  // access choice in the product look like housekeeping.
  expect(named(both, "staff")).toBeUndefined();

  expect(
    (await revokeGroup(sessionCookie, org.name, "hr", "quality-committee"))
      .status,
  ).toBe(200);
  expect(named(await readGroups(), "quality-committee")?.binders).toEqual([
    "clinical",
  ]);
});

test("the organization lists its binders, so a group can be added to one", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  expect((await createWorkspace(sessionCookie, org.name, "HR")).status).toBe(
    201,
  );

  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org.name}/people`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as { binders: string[] }).binders).toEqual([
    "clinical",
    "hr",
  ]);
});

test("Owners cannot be added to or taken off a binder, because it is neither", async () => {
  // Gitea gives Owners admin over the whole organization implicitly and never
  // grants it onto a repository, so offering either act would be offering
  // something that cannot happen — and a revoke that silently did nothing
  // would read as an owner losing access when they had not.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  expect(
    (await grantGroup(sessionCookie, org.name, "clinical", "Owners")).status,
  ).toBe(400);
  expect(
    (await revokeGroup(sessionCookie, org.name, "clinical", "Owners")).status,
  ).toBe(400);
});

test("a group that is not there is a 404, on the organization and on a binder", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  expect(
    (await addToGroup(sessionCookie, org.name, "no-such-group", "nobody"))
      .status,
  ).toBe(404);
  expect(
    (await grantGroup(sessionCookie, org.name, "clinical", "no-such-group"))
      .status,
  ).toBe(404);
  expect(
    (await grantGroup(sessionCookie, org.name, "no-such-binder", "staff"))
      .status,
  ).toBe(404);
});

test("a group needs a name Gitea can carry, and one of three levels", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  expect(
    (await createGroup(sessionCookie, org.name, "!!!", "reviewer")).status,
  ).toBe(400);
  expect(
    (await createGroup(sessionCookie, org.name, "Quality", "supervisor"))
      .status,
  ).toBe(400);
});

async function readBinderPeople(
  sessionCookie: string,
  org: string,
  workspace: string,
): Promise<{
  people: Array<{
    login: string;
    access: string;
    through: string;
    individual: boolean;
    groups: string[];
    seat: boolean;
  }>;
  groups: Array<{ name: string }>;
  openToOrganization: boolean;
}> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/people`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as never;
}

async function addBinderPerson(
  sessionCookie: string,
  org: string,
  workspace: string,
  username: string,
  level: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/people`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ username, level }),
    },
  );
  return { status: response.status, body: await response.text() };
}

async function setBinderPersonLevel(
  sessionCookie: string,
  org: string,
  workspace: string,
  username: string,
  level: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/people/${username}`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ username, level }),
    },
  );
  return { status: response.status, body: await response.text() };
}

async function removeBinderPerson(
  sessionCookie: string,
  org: string,
  workspace: string,
  username: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/people/${username}`,
    { method: "DELETE", headers: authHeaders(sessionCookie) },
  );
  return { status: response.status, body: await response.text() };
}

test("a person added to a binder gets its role team, made on first use", async () => {
  // The lazy team: provisioning makes none, so a binder that only ever adopts
  // groups never manufactures one. An organization with twenty binders and
  // three recurring groups holds five to eight teams rather than sixty-two, and
  // each exists because somebody's action made it.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );

  const reviewer = buildCredentials();
  await signUp(reviewer);

  const before = await giteaGet<Array<{ name: string }>>(
    ownerToken,
    `/orgs/${org.name}/teams`,
  );
  expect(before.map((team) => team.name)).not.toContain("clinical-reviewers");

  const added = await addBinderPerson(
    sessionCookie,
    org.name,
    "clinical",
    reviewer.username,
    "reviewer",
  );
  expect(added.status, added.body).toBe(200);

  const after = await giteaGet<Array<{ name: string }>>(
    ownerToken,
    `/orgs/${org.name}/teams`,
  );
  expect(after.map((team) => team.name)).toContain("clinical-reviewers");

  const people = await readBinderPeople(sessionCookie, org.name, "clinical");
  const row = people.people.find(
    (person) => person.login === reviewer.username,
  );
  expect(row, JSON.stringify(people.people)).toBeTruthy();
  expect(row).toMatchObject({
    access: "read",
    through: "clinical-reviewers",
    // Their access is this binder's own, so this binder can change it.
    individual: true,
    // ADR 0004 promises reviewers cost nothing, and a seat is write or better.
    seat: false,
  });

  // The grant is only half of it: without the whitelist the approval would be
  // recorded, displayed, and satisfy nothing.
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners", "clinical-reviewers", "staff"]);
});

test("a reviewer promoted to editor can push, and demoted cannot", async () => {
  // The claim the design asks this piece to prove, and it is asked of Gitea
  // rather than of our own payload: the level means nothing unless the merge
  // and the push agree with it.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const person = buildCredentials();
  const personCookie = await signUp(person);
  const personToken = await createUserToken(person.username, person.password);

  const canPush = async (): Promise<boolean> => {
    const repo = await giteaGet<{ permissions?: { push?: boolean } }>(
      personToken,
      `/repos/${org.name}/clinical`,
    );
    return repo.permissions?.push === true;
  };

  expect(
    (
      await addBinderPerson(
        sessionCookie,
        org.name,
        "clinical",
        person.username,
        "reviewer",
      )
    ).status,
  ).toBe(200);
  expect(await canPush()).toBe(false);

  const promoted = await setBinderPersonLevel(
    sessionCookie,
    org.name,
    "clinical",
    person.username,
    "editor",
  );
  expect(promoted.status, promoted.body).toBe(200);
  expect(await canPush()).toBe(true);

  // A move leaves the role they held, so they cannot end in two of this
  // binder's teams with their access decided by whichever ranks higher.
  const promotedPeople = JSON.parse(promoted.body) as {
    people: Array<{ login: string; access: string; seat: boolean }>;
  };
  expect(
    promotedPeople.people.find((row) => row.login === person.username),
  ).toMatchObject({ access: "write", seat: true });

  expect(
    (
      await setBinderPersonLevel(
        sessionCookie,
        org.name,
        "clinical",
        person.username,
        "reviewer",
      )
    ).status,
  ).toBe(200);
  expect(await canPush()).toBe(false);

  // And out entirely.
  const removed = await removeBinderPerson(
    sessionCookie,
    org.name,
    "clinical",
    person.username,
  );
  expect(removed.status, removed.body).toBe(200);

  // **Out of the binder is not out of the organization**, and this is where
  // that shows. Adding somebody to a binder admits them to the organization, so
  // they are in `staff` — and `staff` is granted here, because the binder is
  // open. Taking them out of its role team leaves them able to read it, which
  // is exactly what "everyone at this organization can read this binder" means.
  // Leaving the organization is its own act, with its own confirmation.
  const after = JSON.parse(removed.body) as {
    people: Array<{ login: string; through: string; individual: boolean }>;
  };
  expect(
    after.people.find((row) => row.login === person.username),
  ).toMatchObject({ through: "staff", individual: false });

  const seen = await readBinderPeople(personCookie, org.name, "clinical");
  expect(seen.openToOrganization).toBe(true);
});

test("a role that comes from a group is refused here, and the refusal says why", async () => {
  // The constraint made visible rather than hidden. A group is one object
  // across every binder it is granted onto, so changing Aisha's role on this
  // row would change it everywhere the group reaches — and a control that has
  // to refuse is worse than a sentence that explains.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  expect(
    (
      await createGroup(
        sessionCookie,
        org.name,
        "Quality Committee",
        "reviewer",
      )
    ).status,
  ).toBe(201);

  const person = buildCredentials();
  await signUp(person);
  expect(
    (
      await addToGroup(
        sessionCookie,
        org.name,
        "quality-committee",
        person.username,
      )
    ).status,
  ).toBe(200);
  expect(
    (await grantGroup(sessionCookie, org.name, "clinical", "quality-committee"))
      .status,
  ).toBe(200);

  const people = await readBinderPeople(sessionCookie, org.name, "clinical");
  expect(
    people.people.find((row) => row.login === person.username),
  ).toMatchObject({ through: "quality-committee", individual: false });

  const refused = await setBinderPersonLevel(
    sessionCookie,
    org.name,
    "clinical",
    person.username,
    "editor",
  );
  expect(refused.status, refused.body).toBe(409);
  // Naming the group is the point: it is also the answer to "why can they
  // approve here", on the row that raised the question.
  expect(refused.body).toContain("quality-committee");

  // Removing them from this binder is refused for the same reason — that
  // button would have to reach into a group and change three other binders.
  expect(
    (
      await removeBinderPerson(
        sessionCookie,
        org.name,
        "clinical",
        person.username,
      )
    ).status,
  ).toBe(409);

  // The escape hatch: one person in a group needing more in this one binder is
  // *added* individually, which sits beside the group rather than changing it.
  expect(
    (
      await addBinderPerson(
        sessionCookie,
        org.name,
        "clinical",
        person.username,
        "editor",
      )
    ).status,
  ).toBe(200);

  const after = await readBinderPeople(sessionCookie, org.name, "clinical");
  expect(
    after.people.find((row) => row.login === person.username),
  ).toMatchObject({
    access: "write",
    through: "clinical-authors",
    individual: true,
  });

  // And the group is untouched, so the other binders it reaches are too.
  const groups = (await (
    await fetch(`${API_BASE_URL}/api/app/orgs/${org.name}/people`, {
      headers: { Cookie: `bindersnap_session=${sessionCookie}` },
    })
  ).json()) as { groups: Array<{ name: string; access: string }> };
  expect(
    groups.groups.find((group) => group.name === "quality-committee")?.access,
  ).toBe("read");
});

test("the binder's people is a bounded read, and an owner is not editable there", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const people = await readBinderPeople(sessionCookie, org.name, "clinical");

  // The creator, through Owners — which Gitea grants org-wide rather than onto
  // this repository, so it is not this binder's to change. They are in `staff`
  // as well, because every member of the organization is; `Owners` is the
  // higher of the two and is therefore what the row reports.
  expect(people.people).toHaveLength(1);
  expect(people.people[0]).toMatchObject({
    login: credentials.username,
    through: "Owners",
    individual: false,
    seat: true,
  });
  // Owners and staff are both shared teams rather than this binder's own, so
  // both are named — and `through` reports Owners, the higher of the two.
  expect(people.people[0]?.groups?.sort()).toEqual(["Owners", "staff"]);
  expect(people.openToOrganization).toBe(true);
});

test("people on a binder that is not there is a 404", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/no-such-binder/people`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status).toBe(404);
});

async function setVisibility(
  sessionCookie: string,
  org: string,
  workspace: string,
  openToOrganization: boolean,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/visibility`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ openToOrganization }),
    },
  );
  return { status: response.status, body: await response.text() };
}

test("a binder can be closed to the organization and opened again", async () => {
  // One switch over one primitive: `staff` granted, or not. Nothing is stored,
  // so the answer cannot disagree with the grant Gitea is the one enforcing.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );

  expect(
    (await readBinderPeople(sessionCookie, org.name, "clinical"))
      .openToOrganization,
  ).toBe(true);

  const closed = await setVisibility(
    sessionCookie,
    org.name,
    "clinical",
    false,
  );
  expect(closed.status, closed.body).toBe(200);
  expect(
    (JSON.parse(closed.body) as { openToOrganization: boolean })
      .openToOrganization,
  ).toBe(false);

  // The whitelist narrows with it. Left behind, `staff` would be a team whose
  // members' approvals still counted on a binder they can no longer read.
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners"]);

  const reopened = await setVisibility(
    sessionCookie,
    org.name,
    "clinical",
    true,
  );
  expect(reopened.status, reopened.body).toBe(200);
  expect(
    (JSON.parse(reopened.body) as { openToOrganization: boolean })
      .openToOrganization,
  ).toBe(true);
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "clinical"),
  ).toEqual(["Owners", "staff"]);
});

test("a restricted binder is not readable by a member who was not added", async () => {
  // The reason `includes_all_repositories` is false on `staff`, made concrete:
  // with it true every binder would be readable by everyone forever with no way
  // back, and an HR investigation binder would be impossible.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const created = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org.name}/binders`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({
        name: "Investigations",
        openToOrganization: false,
      }),
    },
  );
  expect(created.status, await created.clone().text()).toBe(201);

  // Asked at creation, so a restricted binder is a choice somebody made rather
  // than a state it drifted into.
  const people = await readBinderPeople(
    sessionCookie,
    org.name,
    "investigations",
  );
  expect(people.openToOrganization).toBe(false);
  expect(people.groups.map((group) => group.name)).not.toContain("staff");

  const ownerToken = await createUserToken(
    credentials.username,
    credentials.password,
  );
  expect(
    await readApprovalsWhitelist(ownerToken, org.name, "investigations"),
  ).toEqual(["Owners"]);

  // A member of the organization who was not added cannot see it. They are in
  // `staff` — every member is — and `staff` is not granted here.
  const member = buildCredentials();
  const memberCookie = await signUp(member);
  expect(
    (
      await addBinderPerson(
        sessionCookie,
        org.name,
        "investigations",
        member.username,
        "reviewer",
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await removeBinderPerson(
        sessionCookie,
        org.name,
        "investigations",
        member.username,
      )
    ).status,
  ).toBe(200);

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/investigations`,
    { headers: { Cookie: `bindersnap_session=${memberCookie}` } },
  );
  expect(response.status).toBe(404);

  // And the open binder beside it stays readable by the same person, which is
  // the whole point of the switch being per binder rather than per organization.
  expect(
    (await createWorkspace(sessionCookie, org.name, "Handbook")).status,
  ).toBe(201);
  expect(
    (
      await fetch(`${API_BASE_URL}/api/app/binders/${org.name}/handbook`, {
        headers: { Cookie: `bindersnap_session=${memberCookie}` },
      })
    ).status,
  ).toBe(200);
});

test("the visibility switch needs an answer, and the binder has to exist", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/visibility`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({}),
    },
  );
  expect(response.status).toBe(400);

  expect(
    (await setVisibility(sessionCookie, org.name, "no-such-binder", true))
      .status,
  ).toBe(404);
});

async function readLibrary(
  sessionCookie: string,
  query?: string,
): Promise<{
  documents: Array<{
    organization: string;
    binder: string;
    slugPath: string;
    name: string;
    folder: string;
    state: string;
    latestVersion: { version: number } | null;
  }>;
  binders: Array<{ organization: string; name: string }>;
  hasMore: boolean;
}> {
  const url = new URL(`${API_BASE_URL}/api/app/documents`);
  if (query) url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { Cookie: `bindersnap_session=${sessionCookie}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as never;
}

test("the library is every policy in every binder, across organizations", async () => {
  // **The replacement for the old repo search**, and the assertion that
  // matters is the cross-binder one: the library used to search Gitea for
  // repositories because a document was one, and the question it answers —
  // "where is that policy" — now spans binders rather than repos.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  // A person with no binders gets an empty library, not an error.
  const empty = await readLibrary(sessionCookie);
  expect(empty.documents).toEqual([]);
  expect(empty.binders).toEqual([]);

  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Corporate")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  for (const [workspace, name, folder] of [
    ["clinical", "Infection Control Policy", "nursing"],
    ["corporate", "Expenses Policy", undefined],
  ] as const) {
    const added = await addDocument(sessionCookie, org.name, workspace, {
      name,
      ...(folder ? { folder } : {}),
    });
    expect(added.status, added.body).toBe(201);
    const { pullRequestNumber } = JSON.parse(added.body) as {
      pullRequestNumber: number;
    };

    // **The library lists the record**, so a policy has to reach `main` before
    // it is in one. Uploaded-and-unpublished used to appear here, mixed in
    // with what was actually in force.
    await approveChange(approver.token, org.name, workspace, pullRequestNumber);
    expect(
      (
        await publishChange(
          sessionCookie,
          org.name,
          workspace,
          pullRequestNumber,
        )
      ).status,
    ).toBe(200);
  }

  const library = await readLibrary(sessionCookie);
  expect(library.binders.map((binder) => binder.name).sort()).toEqual([
    "clinical",
    "corporate",
  ]);

  // Both policies, each naming the binder it is filed in — which is what
  // replaced "who owns this repository".
  const rows = library.documents.map(
    (document) => `${document.binder}:${document.slugPath}`,
  );
  expect(rows.sort()).toEqual([
    "clinical:nursing/infection-control-policy",
    "corporate:expenses-policy",
  ]);

  // Every row is on `main`. That is the rule the whole list turns on.
  expect(
    library.documents.every((document) => document.state === "published"),
  ).toBe(true);
  expect(
    library.documents.every((document) => document.latestVersion !== null),
  ).toBe(true);
});

test("the library and quick find answer the same question", async () => {
  // They run through one server-side read on purpose: two implementations of
  // "where is that policy" would eventually disagree about which binders
  // count, and the one that disagreed would be the one nobody tested.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  // Both onto `main`: the library and quick find each list the record, so a
  // policy that has not been published is in neither.
  for (const [name, folder] of [
    ["Infection Control Policy", "nursing"],
    ["Expenses Policy", undefined],
  ] as const) {
    const added = await addDocument(sessionCookie, org.name, "clinical", {
      name,
      ...(folder ? { folder } : {}),
    });
    expect(added.status, added.body).toBe(201);
    const { pullRequestNumber } = JSON.parse(added.body) as {
      pullRequestNumber: number;
    };
    await approveChange(
      approver.token,
      org.name,
      "clinical",
      pullRequestNumber,
    );
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
  }

  // The stored name is the slug — the app formats it for display, the way the
  // binder's own Documents tab does. Asserting the slug here is asserting what
  // the server actually holds.
  const narrowed = await readLibrary(sessionCookie, "infection");
  expect(narrowed.documents.map((document) => document.name)).toEqual([
    "infection-control-policy",
  ]);

  const search = await fetch(
    `${API_BASE_URL}/api/app/documents/search?q=infection`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(search.status).toBe(200);
  const found = (await search.json()) as {
    documents: Array<{ slugPath: string; binder: string }>;
  };
  expect(found.documents.map((document) => document.slugPath)).toEqual([
    "nursing/infection-control-policy",
  ]);
  expect(found.documents[0]?.binder).toBe("clinical");
});

test("a binder somebody cannot see is not in their library", async () => {
  // The library is read with the caller's own token, so this is Gitea's answer
  // rather than a filter of ours — but it is the one property of the page that
  // would be a disclosure if it were wrong.
  const owner = buildCredentials();
  const ownerCookie = await signUp(owner);
  const org = await createOrganization(ownerCookie, `Binder ${randomUUID()}`);
  expect(
    (
      await createWorkspace(
        ownerCookie,
        org.name,
        "Investigations",
        undefined,
        false,
      )
    ).status,
  ).toBe(201);
  const added = await addDocument(ownerCookie, org.name, "investigations", {
    name: "Case Notes",
  });
  expect(added.status, added.body).toBe(201);
  const { pullRequestNumber } = JSON.parse(added.body) as {
    pullRequestNumber: number;
  };

  // Published, because the library lists the record — the owner has to be able
  // to see it for "the outsider cannot" to mean anything.
  //
  // The approver is a second *organization owner* rather than staff: this
  // binder is deliberately closed to the organization, so somebody in `staff`
  // cannot see the change, let alone approve it.
  const approver = buildCredentials();
  await signUp(approver);
  expect(
    (await addOrgPerson(ownerCookie, org.name, approver.username, true)).status,
  ).toBeLessThan(300);
  const approverToken = await createUserToken(
    approver.username,
    approver.password,
  );
  await approveChange(
    approverToken,
    org.name,
    "investigations",
    pullRequestNumber,
  );
  expect(
    (
      await publishChange(
        ownerCookie,
        org.name,
        "investigations",
        pullRequestNumber,
      )
    ).status,
  ).toBe(200);

  const outsider = buildCredentials();
  const outsiderCookie = await signUp(outsider);

  const theirs = await readLibrary(outsiderCookie);
  expect(theirs.documents).toEqual([]);
  expect(theirs.binders).toEqual([]);

  // And the owner still sees it, so the empty answer above is about access
  // rather than about the library being broken.
  const mine = await readLibrary(ownerCookie);
  expect(mine.documents.map((document) => document.slugPath)).toEqual([
    "case-notes",
  ]);
});

async function readSettings(
  sessionCookie: string,
  org: string,
  workspace: string,
): Promise<{
  rules: {
    requiredApprovals: number | null;
    blockOnUnresolvedThreads: boolean;
  };
  signOff: {
    enforced: boolean;
    exists: boolean;
    rules: Array<{
      scope: "binder" | "folder" | "document";
      target: string;
      teams: string[];
      users: string[];
    }>;
    unreadable: Array<{ line: number; text: string }>;
    folders: string[];
    documents: Array<{
      uid: string;
      slugPath: string;
      name: string;
      folder: string;
    }>;
    unnameableDocuments: number;
    groups: string[];
    emptyGroups: string[];
    pendingChange: number | null;
  };
  canManage: boolean;
}> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/settings`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as never;
}

test("a binder past Gitea's tag page still knows every version", async () => {
  // **Gitea's tag list is paged, and the defaults are small.** Measured against
  // this stack on 2026-09-08 with a repository of sixty tags: an
  // unparameterised read returns 30, and asking for `limit=100` silently
  // returns 50 — `MaxResponseItems` caps it. Neither says anything about the
  // rest.
  //
  // A binder's tags are its version history, so truncating them is not a
  // display bug: past thirty versions the History tab would quietly stop
  // listing versions that exist, and the next version computed for a publish
  // would be one that had already been used. Thirty versions is ten documents
  // at v3.
  //
  // The tags are written directly rather than by publishing thirty-five
  // changes, because what is under test is the *read*.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control Policy",
    folder: "nursing",
  });
  expect(added.status, added.body).toBe(201);
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

  // The document has to be on `main` before its versions mean anything: a
  // version tag is grouped by the identity in the tree, so tags naming a
  // document the binder does not hold are not versions of anything (ADR 0005).
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

  // Well past both page sizes. Publishing wrote v1, so the rest are written
  // directly — what is under test is the *read*, not thirty-five merges.
  const uid = uidOf(documentPath);
  const TOTAL = 65;
  for (let version = 2; version <= TOTAL; version += 1) {
    const response = await fetch(
      `${GITEA_URL}/api/v1/repos/${org.name}/clinical/tags`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tag_name: `${uid}/v${version}`,
          target: "main",
          message: `v${version}`,
        }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(201);
  }

  const history = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/history`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(history.status, await history.clone().text()).toBe(200);

  const versions = (
    (await history.json()) as {
      versions: Array<{ slugPath: string; version: number }>;
    }
  ).versions.filter((entry) => entry.slugPath === slugPath);

  // Every one of them, not the first page.
  expect(versions).toHaveLength(TOTAL);
  expect(Math.max(...versions.map((entry) => entry.version))).toBe(TOTAL);
});

async function setBinderRules(
  sessionCookie: string,
  org: string,
  workspace: string,
  blockOnUnresolvedThreads: boolean,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/rules`,
    {
      method: "PATCH",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ blockOnUnresolvedThreads }),
    },
  );
  return { status: response.status, body: await response.text() };
}

test("a binder's thread rule is changed immediately, and read back", async () => {
  // **Immediate, unlike a sign-off rule**, and the difference is the design
  // rather than an inconsistency: a sign-off rule decides who has to approve a
  // change, so changing it is itself an approved change. This decides whether
  // the binder waits for discussions to be resolved — it gates nobody out and
  // changes no permission.
  //
  // It used to live in a JSON file on a `bindersnap-config` branch, which ADR
  // 0004's migration step 5 retires: it is configuration, so it is a typed
  // table, and the change is recorded in `settings_events` rather than as a
  // commit.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  // The default is permissive, and a binder nobody has configured says so
  // rather than reporting an unknown.
  const before = await readSettings(sessionCookie, org.name, "clinical");
  expect(before.rules.blockOnUnresolvedThreads).toBe(false);

  const turnedOn = await setBinderRules(
    sessionCookie,
    org.name,
    "clinical",
    true,
  );
  expect(turnedOn.status, turnedOn.body).toBe(200);

  const after = await readSettings(sessionCookie, org.name, "clinical");
  expect(after.rules.blockOnUnresolvedThreads).toBe(true);

  // And back off again, because a rule that is off is still a rule somebody
  // chose.
  expect(
    (await setBinderRules(sessionCookie, org.name, "clinical", false)).status,
  ).toBe(200);
  expect(
    (await readSettings(sessionCookie, org.name, "clinical")).rules
      .blockOnUnresolvedThreads,
  ).toBe(false);
});

test("changing a binder's rules needs an answer, a real binder, and admin", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const nothingSaid = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical/rules`,
    {
      method: "PATCH",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({}),
    },
  );
  expect(nothingSaid.status).toBe(400);

  const nowhere = await setBinderRules(
    sessionCookie,
    org.name,
    "no-such-binder",
    true,
  );
  expect(nowhere.status).toBe(404);

  // A member who is not an administrator of the binder is refused. Permission
  // is Gitea's answer — read as them — not a role table of ours.
  const member = buildCredentials();
  const memberCookie = await signUp(member);
  expect(
    (
      await addBinderPerson(
        sessionCookie,
        org.name,
        "clinical",
        member.username,
        "reviewer",
      )
    ).status,
  ).toBe(200);

  const refused = await setBinderRules(
    memberCookie,
    org.name,
    "clinical",
    true,
  );
  expect(refused.status, refused.body).toBe(403);
});

test("publishing stamps the policy in force onto the version's tag", async () => {
  // ADR 0004: "when configuration shapes what happened, do not version the
  // configuration — stamp it onto the event." This is that, asserted where it
  // actually has to be true: on the annotated tag in Gitea, readable from a
  // bare clone with no application and no database running.
  const owner = buildCredentials();
  const ownerCookie = await signUp(owner);
  const org = await createOrganization(ownerCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(ownerCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(owner.username, owner.password);
  const approver = await addApprover(ownerToken, org.name, "clinical");

  const added = await addDocument(ownerCookie, org.name, "clinical", {
    name: "Infection Control Policy",
    folder: "nursing",
  });
  expect(added.status, added.body).toBe(201);
  const { slugPath, documentPath } = JSON.parse(added.body) as {
    slugPath: string;
    documentPath: string;
  };

  const listed = await listChanges(ownerCookie, org.name, "clinical", "open");
  const change = (
    JSON.parse(listed.body) as { changes: Array<{ number: number }> }
  ).changes[0];
  expect(change, listed.body).toBeTruthy();

  await approveChange(approver.token, org.name, "clinical", change!.number);
  expect(
    (await publishChange(ownerCookie, org.name, "clinical", change!.number))
      .status,
  ).toBe(200);

  // Read the tag back the way a clone would.
  const tag = await giteaGet<{ message?: string }>(
    ownerToken,
    `/repos/${org.name}/clinical/tags/${encodeURIComponent(
      `${uidOf(documentPath)}/v1`,
    )}`,
  );

  // **What the tag name stopped saying, the message says** (ADR 0005). The
  // tag is a ULID now, so the title and the path are stamped onto the event —
  // both point-in-time facts a rename would otherwise make unrecoverable.
  expect(tag.message?.split("\n")[0]).toBe(
    `Infection Control Policy v1 — ${documentPath}`,
  );
  expect(tag.message).toContain(
    "Title at this version: Infection Control Policy",
  );
  expect(tag.message).toContain(`Filed at: ${slugPath}`);

  expect(tag.message).toContain("The approval policy in force");
  expect(tag.message).toContain("Approvals required: 1");
  expect(tag.message).toContain(
    `Approved by: ${approver.credentials.username}`,
  );
  // Both sides of every rule: one that was off is still a rule somebody chose,
  // and a stamp that only listed what was on would be silent about the rest.
  expect(tag.message).toContain(
    "Unresolved discussions blocked publishing: no",
  );
  expect(tag.message).toContain(`Published by: ${owner.username}`);
  expect(tag.message).toContain(`From change: #${change!.number}`);
});

async function proposeSignOff(
  sessionCookie: string,
  org: string,
  workspace: string,
  rules: Array<{
    scope: "binder" | "folder" | "document";
    target: string;
    teams?: string[];
    users?: string[];
  }>,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/rules/sign-off`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ rules }),
    },
  );
  return { status: response.status, body: await response.text() };
}

test("a new binder is protected by the per-folder gate, on a Gitea that has it", async () => {
  // The capability is read back rather than assumed, because dev runs a 28.0.0
  // nightly and production runs 1.27.3, which accepts the field on a write and
  // silently drops it. This asserts which of the two the stack under test is —
  // so if CI ever moves back to a released tag, the sign-off tests below fail
  // with a cause somebody can name instead of a mystery.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const settings = await readSettings(sessionCookie, org.name, "clinical");
  expect(
    settings.signOff.enforced,
    "block_on_codeowner_reviews did not stick — is this Gitea 28.0.0?",
  ).toBe(true);

  // No rules yet, and the binder says so rather than pretending to have some.
  expect(settings.signOff.exists).toBe(false);
  expect(settings.signOff.rules).toEqual([]);
  expect(settings.signOff.pendingChange).toBeNull();
});

test("proposing sign-off rules opens a change and changes nothing yet", async () => {
  // The whole point of the endpoint returning a change number. `main` is
  // protected, so the rules that decide who approves are themselves approved —
  // and a caller that gets a number back cannot report otherwise.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);
  expect(
    (
      await addDocument(sessionCookie, org.name, "clinical", {
        name: "Infection Control Policy",
        folder: "nursing",
      })
    ).status,
  ).toBe(201);

  const group = await createGroup(
    sessionCookie,
    org.name,
    "Infection Control",
    "reviewer",
  );
  expect(group.status, group.body).toBe(201);

  const proposed = await proposeSignOff(sessionCookie, org.name, "clinical", [
    { scope: "folder", target: "nursing", teams: ["infection-control"] },
  ]);
  expect(proposed.status, proposed.body).toBe(201);
  const { changeNumber } = JSON.parse(proposed.body) as {
    changeNumber: number;
  };
  expect(changeNumber).toBeGreaterThan(0);

  const settings = await readSettings(sessionCookie, org.name, "clinical");
  // Still nothing on `main` — the rules are in review, not in force.
  expect(settings.signOff.exists).toBe(false);
  expect(settings.signOff.rules).toEqual([]);
  // And the binder knows a change is waiting, so it will not offer a second.
  expect(settings.signOff.pendingChange).toBe(changeNumber);

  const second = await proposeSignOff(sessionCookie, org.name, "clinical", [
    { scope: "folder", target: "nursing", teams: ["infection-control"] },
  ]);
  expect(second.status, second.body).toBe(409);
  expect(second.body).toContain(String(changeNumber));
});

test("a rule naming a group the organization does not have is refused before anything is written", async () => {
  // The refusal the generator owes. Gitea drops a rule it cannot satisfy with
  // nothing but a log warning, so a bad rule does not fail loudly — it stops
  // enforcing while the screen still says sign-off is required.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const refused = await proposeSignOff(sessionCookie, org.name, "clinical", [
    { scope: "folder", target: "nursing", teams: ["no-such-committee"] },
  ]);
  expect(refused.status, refused.body).toBe(422);
  expect(refused.body).toContain("no-such-committee");

  // Nothing was written, so no change is left behind for somebody to find.
  const settings = await readSettings(sessionCookie, org.name, "clinical");
  expect(settings.signOff.pendingChange).toBeNull();

  // And a rule with nobody on it is refused for its own reason.
  const empty = await proposeSignOff(sessionCookie, org.name, "clinical", [
    { scope: "folder", target: "nursing" },
  ]);
  expect(empty.status, empty.body).toBe(422);
  expect(empty.body).toContain("nobody on it");
});

test("published sign-off rules gate the folder they name", async () => {
  // **The assertion that proves the feature.** Everything else checks that a
  // file was written; this checks that Gitea holds a merge for it, and that a
  // member of the named *group* is what releases it — which is the whole reason
  // 28.0.0 is worth the upgrade. On 1.27.3 a team code owner enforces nothing.
  const owner = buildCredentials();
  const ownerCookie = await signUp(owner);
  const org = await createOrganization(ownerCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(ownerCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(owner.username, owner.password);

  // Two reviewers: one in the nursing sign-off group, one not. The one who is
  // not is how the approval count gets met without satisfying the rule — the
  // only way to observe the gate on its own.
  const signer = await addApprover(ownerToken, org.name, "clinical");
  const bystander = await addApprover(ownerToken, org.name, "clinical");

  const group = await createGroup(
    ownerCookie,
    org.name,
    "Infection Control",
    "reviewer",
  );
  expect(group.status, group.body).toBe(201);
  expect(
    (
      await addToGroup(
        ownerCookie,
        org.name,
        "infection-control",
        signer.credentials.username,
      )
    ).status,
  ).toBe(200);

  // Put the rules in force: propose, approve, publish.
  const proposed = await proposeSignOff(ownerCookie, org.name, "clinical", [
    { scope: "folder", target: "nursing", teams: ["infection-control"] },
  ]);
  expect(proposed.status, proposed.body).toBe(201);
  const rulesChange = (JSON.parse(proposed.body) as { changeNumber: number })
    .changeNumber;

  await approveChange(bystander.token, org.name, "clinical", rulesChange);
  expect(
    (await publishChange(ownerCookie, org.name, "clinical", rulesChange))
      .status,
  ).toBe(200);

  const inForce = await readSettings(ownerCookie, org.name, "clinical");
  expect(inForce.signOff.exists).toBe(true);
  expect(inForce.signOff.rules).toEqual([
    {
      scope: "folder",
      target: "nursing",
      teams: ["infection-control"],
      users: [],
    },
  ]);
  expect(inForce.signOff.unreadable).toEqual([]);

  // Now a change to that folder. The bystander's approval meets the count and
  // satisfies no rule.
  const added = await addDocument(ownerCookie, org.name, "clinical", {
    name: "Infection Control Policy",
    folder: "nursing",
  });
  expect(added.status, added.body).toBe(201);
  const { slugPath, documentPath } = JSON.parse(added.body) as {
    slugPath: string;
    documentPath: string;
  };

  const listed = await listChanges(ownerCookie, org.name, "clinical", "open");
  expect(listed.status, listed.body).toBe(200);
  const policyChange = (
    JSON.parse(listed.body) as { changes: Array<{ number: number }> }
  ).changes[0];
  expect(policyChange, listed.body).toBeTruthy();

  await approveChange(
    bystander.token,
    org.name,
    "clinical",
    policyChange!.number,
  );

  const blocked = await publishChange(
    ownerCookie,
    org.name,
    "clinical",
    policyChange!.number,
  );
  expect(
    blocked.status,
    `the nursing rule did not hold the merge: ${blocked.body}`,
  ).not.toBe(200);

  // A member of the named group approves, and it goes through.
  await approveChange(signer.token, org.name, "clinical", policyChange!.number);
  const released = await publishChange(
    ownerCookie,
    org.name,
    "clinical",
    policyChange!.number,
  );
  expect(released.status, released.body).toBe(200);
});

test("a sign-off rule over one document gates that document and no other", async () => {
  // The scope the folder test above cannot reach. A rule over one policy is
  // written against its identity rather than its path (ADR 0005), so it keeps
  // applying through a retitle — and it has to leave every neighbour alone, or
  // a binder ends up demanding sign-off on policies nobody chose.
  const owner = buildCredentials();
  const ownerCookie = await signUp(owner);
  const org = await createOrganization(ownerCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(ownerCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const ownerToken = await createUserToken(owner.username, owner.password);
  const signer = await addApprover(ownerToken, org.name, "clinical");
  const bystander = await addApprover(ownerToken, org.name, "clinical");

  expect(
    (await createGroup(ownerCookie, org.name, "Infection Control", "reviewer"))
      .status,
  ).toBe(201);
  expect(
    (
      await addToGroup(
        ownerCookie,
        org.name,
        "infection-control",
        signer.credentials.username,
      )
    ).status,
  ).toBe(200);

  // Two policies in the same folder, both published, so the rule has a
  // neighbour to leave alone.
  const guarded = await publishNewDocument(
    ownerCookie,
    bystander.token,
    org.name,
    "Hand Hygiene",
    "nursing",
  );
  const neighbour = await publishNewDocument(
    ownerCookie,
    bystander.token,
    org.name,
    "Handover",
    "nursing",
  );

  // The rule names one of them, by identity.
  const proposed = await proposeSignOff(ownerCookie, org.name, "clinical", [
    {
      scope: "document",
      target: uidOf(guarded.documentPath),
      teams: ["infection-control"],
    },
  ]);
  expect(proposed.status, proposed.body).toBe(201);
  const rulesChange = (JSON.parse(proposed.body) as { changeNumber: number })
    .changeNumber;
  await approveChange(bystander.token, org.name, "clinical", rulesChange);
  expect(
    (await publishChange(ownerCookie, org.name, "clinical", rulesChange))
      .status,
  ).toBe(200);

  const inForce = await readSettings(ownerCookie, org.name, "clinical");
  expect(inForce.signOff.rules).toEqual([
    {
      scope: "document",
      target: uidOf(guarded.documentPath),
      teams: ["infection-control"],
      users: [],
    },
  ]);
  // And the page can name the document a rule is about, rather than showing a
  // ULID to somebody being asked to approve it.
  expect(inForce.signOff.documents.map((entry) => entry.uid)).toContain(
    uidOf(guarded.documentPath),
  );

  // A revision to the guarded policy: the count is met and the rule is not.
  const guardedChange = await reviseDocument(
    ownerCookie,
    ownerToken,
    org.name,
    guarded.documentPath,
  );
  await approveChange(bystander.token, org.name, "clinical", guardedChange);
  const blocked = await publishChange(
    ownerCookie,
    org.name,
    "clinical",
    guardedChange,
  );
  expect(
    blocked.status,
    `the document's own rule did not hold the merge: ${blocked.body}`,
  ).not.toBe(200);

  await approveChange(signer.token, org.name, "clinical", guardedChange);
  expect(
    (await publishChange(ownerCookie, org.name, "clinical", guardedChange))
      .status,
  ).toBe(200);

  // The neighbour is in the same folder and is not covered. The bystander's
  // approval alone is enough.
  const neighbourChange = await reviseDocument(
    ownerCookie,
    ownerToken,
    org.name,
    neighbour.documentPath,
  );
  await approveChange(bystander.token, org.name, "clinical", neighbourChange);
  const released = await publishChange(
    ownerCookie,
    org.name,
    "clinical",
    neighbourChange,
  );
  expect(
    released.status,
    `a rule over one document blocked a change to another: ${released.body}`,
  ).toBe(200);
});

/** Add a policy and get it onto `main`, so a rule has something to guard. */
async function publishNewDocument(
  sessionCookie: string,
  approverToken: string,
  org: string,
  name: string,
  folder: string,
): Promise<{ slugPath: string; documentPath: string }> {
  const added = await addDocument(sessionCookie, org, "clinical", {
    name,
    folder,
  });
  expect(added.status, added.body).toBe(201);
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

  await approveChange(approverToken, org, "clinical", pullRequestNumber);
  expect(
    (await publishChange(sessionCookie, org, "clinical", pullRequestNumber))
      .status,
  ).toBe(200);

  return { slugPath, documentPath };
}

/** Open a change that edits an existing document, and answer with its number. */
async function reviseDocument(
  sessionCookie: string,
  token: string,
  org: string,
  documentPath: string,
): Promise<number> {
  const branch = `upload/${documentPath.split(".")[0]}/${randomUUID().slice(0, 8)}`;
  expect(
    (
      await fetch(`${GITEA_URL}/api/v1/repos/${org}/clinical/branches`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          new_branch_name: branch,
          old_branch_name: "main",
        }),
      })
    ).status,
  ).toBe(201);

  const existing = await giteaGet<{ sha: string }>(
    token,
    `/repos/${org}/clinical/contents/${documentPath}?ref=main`,
  );

  const written = await fetch(
    `${GITEA_URL}/api/v1/repos/${org}/clinical/contents/${documentPath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch,
        sha: existing.sha,
        message: "Revise",
        content: Buffer.from(`revised ${randomUUID()}`).toString("base64"),
      }),
    },
  );
  expect(written.status, await written.clone().text()).toBe(200);

  const pull = await fetch(`${GITEA_URL}/api/v1/repos/${org}/clinical/pulls`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ head: branch, base: "main", title: "Revise" }),
  });
  expect(pull.status, await pull.clone().text()).toBe(201);
  const { number } = (await pull.json()) as { number: number };

  // Gitea computes mergeability in the background, and an approval submitted
  // while that runs can be dismissed by it.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return number;
}

async function setOrgRole(
  sessionCookie: string,
  org: string,
  username: string,
  owner: boolean,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org}/people/${username}/role`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({ owner }),
    },
  );
  return { status: response.status, body: await response.text() };
}

async function removeOrgPerson(
  sessionCookie: string,
  org: string,
  username: string,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org}/people/${username}`,
    { method: "DELETE", headers: authHeaders(sessionCookie) },
  );
  return { status: response.status, body: await response.text() };
}

async function addOrgPerson(
  sessionCookie: string,
  org: string,
  username: string,
  owner = false,
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ username, owner }),
  });
  return { status: response.status, body: await response.text() };
}

test("an owner adds somebody to the organization, as a member or as an owner", async () => {
  // ADR 0004 ships without invitations, so this is how anybody gets in: an
  // owner names an existing account. `staff` is what makes them a member, and
  // it is what "open to the organization" grants against — so the test that
  // matters is not that the row appears, it is that the new member can read a
  // binder nobody added them to.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const member = buildCredentials();
  const memberCookie = await signUp(member);

  // Before: the binder is open to the organization, but they are not in it.
  const before = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical`,
    { headers: { Cookie: `bindersnap_session=${memberCookie}` } },
  );
  expect(before.status).toBe(404);

  const added = await addOrgPerson(sessionCookie, org.name, member.username);
  expect(added.status, added.body).toBe(200);
  const people = JSON.parse(added.body) as {
    people: Array<{ login: string; isOwner: boolean }>;
  };
  expect(
    people.people.find((row) => row.login === member.username),
  ).toMatchObject({ login: member.username, isOwner: false });

  // After: `staff` reaches the binder, so they can read it without anybody
  // adding them to it. That is the whole point of the membership team.
  const after = await fetch(
    `${API_BASE_URL}/api/app/binders/${org.name}/clinical`,
    { headers: { Cookie: `bindersnap_session=${memberCookie}` } },
  );
  expect(after.status, await after.clone().text()).toBe(200);

  // And an owner can be added in one act rather than added and then promoted.
  const second = buildCredentials();
  await signUp(second);
  const asOwner = await addOrgPerson(
    sessionCookie,
    org.name,
    second.username,
    true,
  );
  expect(asOwner.status, asOwner.body).toBe(200);
  expect(
    (
      JSON.parse(asOwner.body) as {
        people: Array<{ login: string; isOwner: boolean }>;
      }
    ).people.find((row) => row.login === second.username)?.isOwner,
  ).toBe(true);
});

test("adding somebody who has no account says so, rather than 404ing the organization", async () => {
  // The visible edge of having no invitation flow, and the one refusal on this
  // route a customer meets in normal use. A bare 404 from `addTeamMember`
  // reads as "no such organization" everywhere above it, which sends an owner
  // hunting the wrong thing entirely.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const response = await addOrgPerson(
    sessionCookie,
    org.name,
    `nobody-${randomUUID().slice(0, 8)}`,
  );
  expect(response.status).toBe(404);
  expect(response.body).toContain("does not have a Bindersnap account");

  // And the organization itself is still findable, which is what distinguishes
  // this 404 from the one that means the org is not there.
  const stillThere = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org.name}/people`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(stillThere.status).toBe(200);
});

test("adding somebody needs a name, and a real organization", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const nameless = await addOrgPerson(sessionCookie, org.name, "   ");
  expect(nameless.status).toBe(400);

  const nowhere = await addOrgPerson(
    sessionCookie,
    `no-such-org-${randomUUID().slice(0, 8)}`,
    credentials.username,
  );
  expect(nowhere.status).toBe(404);
});

test("a member cannot add themselves to somebody else's organization", async () => {
  // Who may do this is Gitea's answer rather than ours — `PUT
  // /teams/{id}/members/...` is guarded by organization ownership — so the
  // check is that we did not accidentally stand in front of it with an
  // app-side one that is more permissive.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const outsider = buildCredentials();
  const outsiderCookie = await signUp(outsider);

  const response = await addOrgPerson(
    outsiderCookie,
    org.name,
    outsider.username,
  );
  expect(response.status).not.toBe(200);
});

test("somebody is promoted to owner and demoted again", async () => {
  // Two rungs and only two: an owner is a member of Gitea's built-in Owners
  // team, so this is one team membership either way and nothing is stored.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const member = buildCredentials();
  await signUp(member);
  expect(
    (
      await addBinderPerson(
        sessionCookie,
        org.name,
        "clinical",
        member.username,
        "reviewer",
      )
    ).status,
  ).toBe(200);

  const promoted = await setOrgRole(
    sessionCookie,
    org.name,
    member.username,
    true,
  );
  expect(promoted.status, promoted.body).toBe(200);
  const asOwner = JSON.parse(promoted.body) as {
    people: Array<{ login: string; isOwner: boolean }>;
  };
  expect(
    asOwner.people.find((row) => row.login === member.username)?.isOwner,
  ).toBe(true);

  // An owner administers every binder in the organization implicitly, so the
  // promotion reaches the binder without anything being granted there.
  const binderPeople = await readBinderPeople(
    sessionCookie,
    org.name,
    "clinical",
  );
  expect(
    binderPeople.people.find((row) => row.login === member.username)?.access,
  ).toBe("owner");

  const demoted = await setOrgRole(
    sessionCookie,
    org.name,
    member.username,
    false,
  );
  expect(demoted.status, demoted.body).toBe(200);
  expect(
    (
      JSON.parse(demoted.body) as {
        people: Array<{ login: string; isOwner: boolean }>;
      }
    ).people.find((row) => row.login === member.username)?.isOwner,
  ).toBe(false);
});

test("the last owner cannot be demoted or removed, by either route", async () => {
  // Both routes hit one rule and say one sentence: they are different requests
  // with the same consequence — an organization nobody can administer, with no
  // way back that does not involve us.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const demoted = await setOrgRole(
    sessionCookie,
    org.name,
    credentials.username,
    false,
  );
  expect(demoted.status, demoted.body).toBe(409);
  expect(demoted.body).toContain("at least one owner");

  const removed = await removeOrgPerson(
    sessionCookie,
    org.name,
    credentials.username,
  );
  expect(removed.status, removed.body).toBe(409);
  expect(removed.body).toContain("at least one owner");

  // With a second owner, the rule stops applying — to either route.
  const second = buildCredentials();
  await signUp(second);
  expect(
    (await setOrgRole(sessionCookie, org.name, second.username, true)).status,
  ).toBe(200);
  expect(
    (await setOrgRole(sessionCookie, org.name, credentials.username, false))
      .status,
  ).toBe(200);
});

test("removing somebody takes their access and leaves the record", async () => {
  // The product's whole claim, and the thing somebody is afraid of at exactly
  // this moment: their commits, versions, approvals and comments are git
  // objects, and removing the person does not touch any of them.
  const author = buildCredentials();
  const authorCookie = await signUp(author);
  const org = await createOrganization(authorCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(authorCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const reviewer = await addApprover(
    await createUserToken(author.username, author.password),
    org.name,
    "clinical",
  );

  const added = await addDocument(authorCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  const { pullRequestNumber, slugPath, documentPath } = JSON.parse(
    added.body,
  ) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

  await approveChange(reviewer.token, org.name, "clinical", pullRequestNumber);
  expect(
    (await publishChange(authorCookie, org.name, "clinical", pullRequestNumber))
      .status,
  ).toBe(200);

  const removed = await removeOrgPerson(
    authorCookie,
    org.name,
    reviewer.credentials.username,
  );
  expect(removed.status, removed.body).toBe(200);
  expect(
    (
      JSON.parse(removed.body) as { people: Array<{ login: string }> }
    ).people.map((row) => row.login),
  ).not.toContain(reviewer.credentials.username);

  // Access is gone: the binder is simply not there for them any more.
  expect(
    (
      await fetch(`${API_BASE_URL}/api/app/binders/${org.name}/clinical`, {
        headers: { Cookie: `bindersnap_session=${reviewer.sessionCookie}` },
      })
    ).status,
  ).toBe(404);

  // The record is not. Their approval still stands against the version it was
  // given on, named, in the binder's history.
  const history = (await (
    await fetch(
      `${API_BASE_URL}/api/app/binders/${org.name}/clinical/history`,
      {
        headers: { Cookie: `bindersnap_session=${authorCookie}` },
      },
    )
  ).json()) as {
    versions: Array<{ slugPath: string; version: number; approvers: string[] }>;
  };

  const version = history.versions.find(
    (entry) => entry.slugPath === slugPath && entry.version === 1,
  );
  expect(version, JSON.stringify(history.versions)).toBeTruthy();
  expect(version!.approvers).toContain(reviewer.credentials.username);
});

test("changing an organization role needs an answer, and a real organization", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);

  const response = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org.name}/people/${credentials.username}/role`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify({}),
    },
  );
  expect(response.status).toBe(400);

  expect(
    (await setOrgRole(sessionCookie, "no-such-org", credentials.username, true))
      .status,
  ).toBe(404);
  expect(
    (await removeOrgPerson(sessionCookie, "no-such-org", credentials.username))
      .status,
  ).toBe(404);
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
    documentPath: string;
    pullRequestNumber: number;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );

  // Add a second document onto the same branch, the way a person revising two
  // policies together would. Its filename carries an identity because every
  // document's does — publish refuses a content file without one, since a file
  // with no identity has no version series to add to (ADR 0005).
  const handoverUid = "01J9A0B1C2D3E4F5G6H7J8K9M0";
  const commit = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/contents/handover.${handoverUid}.md`,
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
  expect(tags.map((t) => t.tag).sort()).toEqual(
    [`${handoverUid}/v1`, `${uidOf(firstPayload.documentPath)}/v1`].sort(),
  );

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
  const {
    pullRequestNumber: firstNumber,
    slugPath,
    documentPath,
  } = JSON.parse(first.body) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

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
  const branch = `upload/${slugPath}/${Date.now()}`;
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
    `/repos/${org.name}/clinical/contents/${documentPath}?ref=main`,
  );
  const updated = await fetch(
    `${GITEA_URL}/api/v1/repos/${org.name}/clinical/contents/${documentPath}`,
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
  ).toEqual([`${uidOf(documentPath)}/v2`]);

  const detail = await getDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
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

async function reviseDocumentFile(
  sessionCookie: string,
  org: string,
  workspace: string,
  documentPath: string,
  fields: { filename: string; body?: string; changeNumber?: number },
): Promise<{ status: number; body: string }> {
  const form = new FormData();
  form.set(
    "file",
    new File([fields.body ?? "revised policy text"], fields.filename, {
      type: "application/octet-stream",
    }),
  );
  form.set("documentPath", documentPath);
  if (fields.changeNumber !== undefined) {
    form.set("changeNumber", String(fields.changeNumber));
  }

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/document-revisions`,
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

test("a document is revised in place, and its version follows", async () => {
  // **The act that did not exist.** Revising a policy meant filing a new one
  // whose name slugged to exactly the same thing — get a character wrong and
  // the binder held two policies instead of one policy on its second version.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "nursing",
  });
  expect(added.status, added.body).toBe(201);
  const {
    pullRequestNumber: firstChange,
    slugPath,
    documentPath,
  } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", firstChange);
  expect(
    (await publishChange(sessionCookie, org.name, "clinical", firstChange))
      .status,
  ).toBe(200);

  const revised = await reviseDocumentFile(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
    { filename: "whatever-the-file-is-called.md" },
  );
  expect(revised.status, revised.body).toBe(201);
  const revision = JSON.parse(revised.body) as {
    documentPath: string;
    slugPath: string;
    pullRequestNumber: number;
  };

  // Same address, same file, whatever the uploaded file happened to be called.
  expect(revision.slugPath).toBe(slugPath);
  expect(revision.documentPath).toBe(documentPath);

  await approveChange(
    approver.token,
    org.name,
    "clinical",
    revision.pullRequestNumber,
  );
  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    revision.pullRequestNumber,
  );
  expect(published.status, published.body).toBe(200);
  expect(
    (JSON.parse(published.body) as { tags: Array<{ tag: string }> }).tags.map(
      (tag) => tag.tag,
    ),
  ).toEqual([`${uidOf(documentPath)}/v2`]);

  // One document in the binder, on v2 — not two documents on v1 each.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ slugPath: string; latestVersion: { version: number } }>;
  };
  expect(documents).toHaveLength(1);
  expect(documents[0]?.slugPath).toBe(slugPath);
  expect(documents[0]?.latestVersion.version).toBe(2);
});

test("a policy can change format and still be the same policy", async () => {
  // The identity is a segment of the filename rather than the whole of it
  // (ADR 0005), so the extension after it can change without the document
  // becoming a different one. A Word policy reissued as a PDF is the same
  // policy on its next version, and its earlier versions are still there.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "nursing",
    filename: "policy.md",
  });
  const {
    pullRequestNumber: firstChange,
    slugPath,
    documentPath,
  } = JSON.parse(added.body) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };
  expect(documentPath.endsWith(".md")).toBe(true);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");
  await approveChange(approver.token, org.name, "clinical", firstChange);
  expect(
    (await publishChange(sessionCookie, org.name, "clinical", firstChange))
      .status,
  ).toBe(200);

  const revised = await reviseDocumentFile(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
    { filename: "reissued.pdf", body: "%PDF-1.4 not really" },
  );
  expect(revised.status, revised.body).toBe(201);
  const revision = JSON.parse(revised.body) as {
    documentPath: string;
    pullRequestNumber: number;
  };
  expect(revision.documentPath).toBe(`${slugPath}.${uidOf(documentPath)}.pdf`);

  await approveChange(
    approver.token,
    org.name,
    "clinical",
    revision.pullRequestNumber,
  );
  expect(
    (
      await publishChange(
        sessionCookie,
        org.name,
        "clinical",
        revision.pullRequestNumber,
      )
    ).status,
  ).toBe(200);

  // The old file is gone from the tree and the new one is there — one commit,
  // not a delete somebody has to notice separately.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ path: string; latestVersion: { version: number } }>;
  };
  expect(documents.map((document) => document.path)).toEqual([
    revision.documentPath,
  ]);

  // And every version is still its version.
  const detail = await getDocument(
    sessionCookie,
    org.name,
    "clinical",
    slugPath,
  );
  const { versions } = JSON.parse(detail.body) as {
    versions: Array<{ version: number }>;
  };
  expect(versions.map((version) => version.version)).toEqual([2, 1]);
});

test("revising something the binder does not hold is refused", async () => {
  // A new policy is added rather than revised, and saying so beats opening a
  // change request that creates a document at an address nobody chose.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const refused = await reviseDocumentFile(
    sessionCookie,
    org.name,
    "clinical",
    "nursing/not-a-policy",
    { filename: "policy.md" },
  );
  expect(refused.status, refused.body).toBe(404);
  expect(refused.body).toContain("not in this binder");
});

test("one change request holds several edits, and publishes them together", async () => {
  // **ADR 0004 §4 made the change the unit of approval**, and until now the
  // product could not express it: every act opened a change request of its own,
  // so three cross-referencing policies meant three approvals that could be
  // published apart. A change request holds as many edits as somebody puts in
  // it now — including a revision of something already on the record.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  // One policy already on the record, so the change can revise something.
  const existing = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
    folder: "nursing",
  });
  const {
    pullRequestNumber: firstChange,
    slugPath: existingSlug,
    documentPath: existingPath,
  } = JSON.parse(existing.body) as {
    pullRequestNumber: number;
    slugPath: string;
    documentPath: string;
  };
  await approveChange(approver.token, org.name, "clinical", firstChange);
  expect(
    (await publishChange(sessionCookie, org.name, "clinical", firstChange))
      .status,
  ).toBe(200);

  // The first act opens a change request.
  const opened = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Falls Prevention",
    folder: "nursing",
  });
  expect(opened.status, opened.body).toBe(201);
  const { pullRequestNumber: changeNumber } = JSON.parse(opened.body) as {
    pullRequestNumber: number;
  };

  // The next two join it rather than starting their own.
  const second = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Restraint Use",
    folder: "nursing",
    changeNumber,
  });
  expect(second.status, second.body).toBe(201);
  expect(
    (JSON.parse(second.body) as { pullRequestNumber: number })
      .pullRequestNumber,
  ).toBe(changeNumber);

  const revised = await reviseDocumentFile(
    sessionCookie,
    org.name,
    "clinical",
    existingSlug,
    { filename: "reissued.md", changeNumber },
  );
  expect(revised.status, revised.body).toBe(201);
  expect(
    (JSON.parse(revised.body) as { pullRequestNumber: number })
      .pullRequestNumber,
  ).toBe(changeNumber);

  // One change open, not three.
  const open = await listChanges(sessionCookie, org.name, "clinical", "open");
  expect(
    (JSON.parse(open.body) as { changes: unknown[] }).changes,
  ).toHaveLength(1);

  // One approval, one publish, three versions.
  await approveChange(approver.token, org.name, "clinical", changeNumber);
  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    changeNumber,
  );
  expect(published.status, published.body).toBe(200);
  const { tags } = JSON.parse(published.body) as {
    tags: Array<{ tag: string; version: number; commitSha: string }>;
  };
  expect(tags).toHaveLength(3);
  // The revised policy is on v2; the two new ones start at v1.
  expect(
    tags.find((tag) => tag.tag.startsWith(`${uidOf(existingPath)}/`))?.version,
  ).toBe(2);
  expect(tags.filter((tag) => tag.version === 1)).toHaveLength(2);
  // All on one commit, because it was one change.
  expect(new Set(tags.map((tag) => tag.commitSha)).size).toBe(1);
});

test("a binder counts an open change against every document in it", async () => {
  // The count used to be read off the branch name, which carries one document.
  // A change request holding three policies would then have shown two of them
  // as having nothing in flight, while a change to them waited for approval —
  // a binder understating what is being changed.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  // Two policies on the record.
  const slugs: string[] = [];
  for (const name of ["Infection Control", "Hand Hygiene"]) {
    const added = await addDocument(sessionCookie, org.name, "clinical", {
      name,
      folder: "nursing",
    });
    const { pullRequestNumber, slugPath } = JSON.parse(added.body) as {
      pullRequestNumber: number;
      slugPath: string;
    };
    slugs.push(slugPath);
    await approveChange(
      approver.token,
      org.name,
      "clinical",
      pullRequestNumber,
    );
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
  }

  // One change request revising both.
  const first = await reviseDocumentFile(
    sessionCookie,
    org.name,
    "clinical",
    slugs[0]!,
    { filename: "a.md" },
  );
  const { pullRequestNumber: changeNumber } = JSON.parse(first.body) as {
    pullRequestNumber: number;
  };
  expect(
    (
      await reviseDocumentFile(sessionCookie, org.name, "clinical", slugs[1]!, {
        filename: "b.md",
        changeNumber,
      })
    ).status,
  ).toBe(201);

  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ slugPath: string; openChangeCount: number }>;
  };
  // Both, not just the one the branch happens to be named after.
  for (const slug of slugs) {
    expect(
      documents.find((document) => document.slugPath === slug)?.openChangeCount,
      slug,
    ).toBe(1);
  }
});

test("a policy cannot be filed into a change that is not open here", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const refused = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Falls Prevention",
    changeNumber: 9999,
  });
  expect(refused.status, refused.body).toBe(409);
  expect(refused.body).toContain("not open in this binder");
});

async function shapeChange(
  sessionCookie: string,
  org: string,
  workspace: string,
  route: "folders" | "folder-renames",
  body: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${workspace}/${route}`,
    {
      method: "POST",
      headers: authHeaders(sessionCookie),
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.text() };
}

test("a folder can be made empty, and survives being published", async () => {
  // **Git has no empty directories**, so making one means committing a
  // placeholder — and `main` is protected, so that goes through a change
  // request. The alternative was folders that exist only once the first policy
  // lands in one, which would make laying out a filing structure impossible.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  const made = await shapeChange(
    sessionCookie,
    org.name,
    "clinical",
    "folders",
    {
      folder: "Ward 3",
    },
  );
  expect(made.status, made.body).toBe(201);
  const { changeNumber } = JSON.parse(made.body) as { changeNumber: number };

  await approveChange(approver.token, org.name, "clinical", changeNumber);
  expect(
    (await publishChange(sessionCookie, org.name, "clinical", changeNumber))
      .status,
  ).toBe(200);

  // It is there, and it holds nothing — which is the whole point.
  const settings = await readSettings(sessionCookie, org.name, "clinical");
  expect(settings.signOff.folders).toContain("ward-3");
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);

  // And making it twice is refused rather than doing nothing.
  const again = await shapeChange(
    sessionCookie,
    org.name,
    "clinical",
    "folders",
    { folder: "ward-3" },
  );
  expect(again.status, again.body).toBe(409);
  expect(again.body).toContain("already has a folder");
});

test("renaming a folder moves everything in it, as one change", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  for (const name of ["Hand Hygiene", "Handover"]) {
    const added = await addDocument(sessionCookie, org.name, "clinical", {
      name,
      folder: "nursing",
    });
    const { pullRequestNumber } = JSON.parse(added.body) as {
      pullRequestNumber: number;
    };
    await approveChange(
      approver.token,
      org.name,
      "clinical",
      pullRequestNumber,
    );
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
  }

  const renamed = await shapeChange(
    sessionCookie,
    org.name,
    "clinical",
    "folder-renames",
    { from: "nursing", to: "infection-control" },
  );
  expect(renamed.status, renamed.body).toBe(201);
  const { changeNumber } = JSON.parse(renamed.body) as { changeNumber: number };

  await approveChange(approver.token, org.name, "clinical", changeNumber);
  const published = await publishChange(
    sessionCookie,
    org.name,
    "clinical",
    changeNumber,
  );
  expect(published.status, published.body).toBe(200);
  // Both documents versioned by the one change, and both still on v2 rather
  // than back at v1.
  expect(
    (JSON.parse(published.body) as { tags: Array<{ version: number }> }).tags
      .map((tag) => tag.version)
      .sort(),
  ).toEqual([2, 2]);

  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  const { documents } = JSON.parse(listed.body) as {
    documents: Array<{ slugPath: string }>;
  };
  expect(documents.map((document) => document.slugPath).sort()).toEqual([
    "infection-control/hand-hygiene",
    "infection-control/handover",
  ]);
});

test("a folder rename that would collide with what is there is refused", async () => {
  // Merging two folders is a thing somebody might want. Doing it by accident,
  // as the result of a typo, is not.
  //
  // And the collision that matters is the **address**, not the path: two
  // policies of the same name carry different identity segments, so their
  // filenames differ while the address a link resolves by does not.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const token = await createUserToken(
    credentials.username,
    credentials.password,
  );
  const approver = await addApprover(token, org.name, "clinical");

  for (const folder of ["nursing", "clinical"]) {
    const added = await addDocument(sessionCookie, org.name, "clinical", {
      name: "Hand Hygiene",
      folder,
    });
    const { pullRequestNumber } = JSON.parse(added.body) as {
      pullRequestNumber: number;
    };
    await approveChange(
      approver.token,
      org.name,
      "clinical",
      pullRequestNumber,
    );
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
  }

  const refused = await shapeChange(
    sessionCookie,
    org.name,
    "clinical",
    "folder-renames",
    { from: "nursing", to: "clinical" },
  );
  expect(refused.status, refused.body).toBe(409);
  expect(refused.body).toContain("cannot share one address");
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
