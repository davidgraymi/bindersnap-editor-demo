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

test("an unpublished document is not in the binder's list, because main is the record", async () => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(sessionCookie, `Binder ${randomUUID()}`);
  expect(
    (await createWorkspace(sessionCookie, org.name, "Clinical")).status,
  ).toBe(201);

  const added = await addDocument(sessionCookie, org.name, "clinical", {
    name: "Infection Control",
  });
  expect(added.status, added.body).toBe(201);

  // The upload is on a branch with an open change. Nothing reaches main except
  // a merged, approved change, and the list reads main — so a document nobody
  // has approved is not yet part of the record.
  const listed = await listDocuments(sessionCookie, org.name, "clinical");
  expect(listed.status, listed.body).toBe(200);
  expect(
    (JSON.parse(listed.body) as { documents: unknown[] }).documents,
  ).toEqual([]);
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
): Promise<{ credentials: Credentials; token: string }> {
  const credentials = buildCredentials();
  await signUp(credentials);

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

  for (let attempt = 1; attempt <= 5; attempt += 1) {
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

    const reviews = (await (
      await fetch(reviewsUrl, {
        headers: { Authorization: `token ${approverToken}` },
      })
    ).json()) as Array<{
      state?: string;
      stale?: boolean;
      dismissed?: boolean;
    }>;

    if (
      reviews.some(
        (review) =>
          review.state === "APPROVED" && !review.stale && !review.dismissed,
      )
    ) {
      return;
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
