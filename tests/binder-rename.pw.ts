/**
 * Giving a binder a new name.
 *
 * **The reason this was worth checking before building:** a binder is a Gitea
 * repository (ADR 0004), so its name is the repository's name and renaming one
 * changes every URL that points at it. A rename that breaks every bookmark and
 * every link in every email is not a feature, it is a trap — so the first test
 * here asks the only question that mattered, against a real Gitea: **does the
 * old name still resolve?**
 *
 * It does. Gitea answers `301` from the old name at both its API and its web
 * UI, and `fetch` follows a redirect by default, so this product's own reads
 * against an old binder name resolve too. That is what makes the promise on
 * the settings page — "links to the old name keep working" — a fact rather
 * than a hope, and it is asserted here rather than assumed.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, openTreeFolder } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 240_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `name-${suffix}`,
    email: `name-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

function authHeaders(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(credentials: Credentials): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify(credentials),
  });
  expect(
    response.status,
    `signup failed: ${await response.clone().text()}`,
  ).toBe(200);
  return (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
}

async function provision(): Promise<{
  session: string;
  org: string;
  binder: string;
}> {
  const session = await signUp(buildCredentials());

  const organization = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: `Riverbend ${randomUUID().slice(0, 6)}` }),
  });
  const org = (
    (await organization.json()) as { organization: { name: string } }
  ).organization.name;

  const created = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: "Clinical Policies" }),
  });
  const body = await created.text();
  expect(created.status, body).toBe(201);
  const binder = (JSON.parse(body) as { workspace: { name: string } }).workspace
    .name;
  expect(binder).toBe("clinical-policies");

  // One policy, so there is something in it to still be there afterwards.
  const form = new FormData();
  form.set(
    "file",
    new Blob(["# Hand Hygiene\n"], { type: "text/markdown" }),
    "hand-hygiene.md",
  );
  form.set("name", "Hand Hygiene");
  form.set("folder", "Nursing");
  const added = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    {
      method: "POST",
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
      body: form,
    },
  );
  const addedBody = await added.text();
  expect(added.status, addedBody).toBe(201);

  // **Published, because a binder lists the record.** An unpublished policy is
  // a change request, not a row — so a rename that left the contents alone
  // would look identical to one that lost them.
  await approveAndPublish(
    session,
    org,
    binder,
    (JSON.parse(addedBody) as { pullRequestNumber: number }).pullRequestNumber,
  );

  return { session, org, binder };
}

/**
 * A second person approves it, and the author publishes it.
 *
 * Retried, because Gitea processes a push asynchronously and dismisses an
 * approval recorded against the old head — so a review can return 200 and be
 * gone a second later. Same shape as the loop in `binder-tree.pw.ts`.
 */
async function approveAndPublish(
  session: string,
  org: string,
  binder: string,
  change: number,
): Promise<void> {
  const approver = buildCredentials();
  const approverSession = await signUp(approver);

  const joined = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: approver.username, owner: false }),
  });
  expect(joined.status, await joined.text()).toBeLessThan(300);

  let published: Response | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const review = await fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
      {
        method: "POST",
        headers: authHeaders(approverSession),
        body: JSON.stringify({ event: "APPROVE" }),
      },
    );
    expect(review.status, await review.text()).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    published = await fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/publish`,
      { method: "POST", headers: authHeaders(session), body: "{}" },
    );
    if (published.status === 200) return;
  }

  expect(
    published?.status,
    `publish never succeeded: ${await published?.text()}`,
  ).toBe(200);
}

async function rename(
  session: string,
  org: string,
  binder: string,
  name: string,
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/app/binders/${org}/${binder}/name`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name }),
  });
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

// ── the act ────────────────────────────────────────────────────────

test("a renamed binder answers to its new name, and still to its old one", async () => {
  // The whole reason this feature needed checking before it was built. If the
  // old name stopped resolving, every link anybody had ever sent would break
  // the moment somebody fixed a spelling — and this would be a trap rather
  // than a feature.
  const { session, org, binder } = await provision();

  const renamed = await rename(session, org, binder, "Clinical Governance");
  const body = await renamed.text();
  expect(renamed.status, body).toBe(200);
  expect(JSON.parse(body)).toMatchObject({
    workspace: "clinical-governance",
    previous: "clinical-policies",
  });

  const byNewName = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/clinical-governance/documents`,
    { headers: authHeaders(session) },
  );
  expect(byNewName.status).toBe(200);
  expect(
    (
      (await byNewName.json()) as { documents: Array<{ slugPath: string }> }
    ).documents.map((entry) => entry.slugPath),
  ).toContain("nursing/hand-hygiene");

  // Gitea answers 301 from the old name and `fetch` follows it, so a bookmark
  // and a link in an email both still land on the binder.
  const byOldName = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/clinical-policies/documents`,
    { headers: authHeaders(session) },
  );
  expect(
    byOldName.status,
    "the old name stopped resolving — every existing link to this binder is broken",
  ).toBe(200);
});

test("the name is slugged the way a new binder's is", async () => {
  // A binder carries no display name of its own; every screen derives what it
  // is called from the slug. A rename that stored something else would make a
  // renamed binder read differently from a new one with the same name.
  const { session, org, binder } = await provision();

  const renamed = await rename(
    session,
    org,
    binder,
    "  Estates & Facilities  ",
  );
  expect(renamed.status, await renamed.clone().text()).toBe(200);
  expect((await renamed.json()).workspace).toBe("estates-facilities");
});

test("a name that is already taken is refused, by name", async () => {
  const { session, org, binder } = await provision();

  const second = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: "Corporate Policies" }),
  });
  expect(second.status, await second.clone().text()).toBe(201);

  const refused = await rename(session, org, binder, "Corporate Policies");
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("corporate-policies");
});

test("the name it already has is refused rather than quietly accepted", async () => {
  const { session, org, binder } = await provision();
  const refused = await rename(session, org, binder, "Clinical Policies");
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("already has");
});

test("a name with nothing usable in it is refused before anything is written", async () => {
  const { session, org, binder } = await provision();

  for (const name of ["", "   ", "···"]) {
    const refused = await rename(session, org, binder, name);
    expect(refused.status, `"${name}" was accepted`).toBe(400);
  }

  // Still where it was.
  const still = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}`,
    { headers: authHeaders(session) },
  );
  expect(still.status).toBe(200);
});

test("somebody who cannot administer the binder cannot rename it", async () => {
  const { session, org, binder } = await provision();

  const stranger = buildCredentials();
  const strangerSession = await signUp(stranger);
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: stranger.username, owner: false }),
  });
  expect(added.status, await added.text()).toBeLessThan(300);

  const refused = await rename(
    strangerSession,
    org,
    binder,
    "Clinical Governance",
  );
  expect(refused.status).toBe(403);
  expect((await refused.json()).error).toContain("administrator");
});

// ── in the browser ─────────────────────────────────────────────────

test("renaming from the settings tab moves the address bar with it", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=settings`);

  const field = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(field).toBeVisible({ timeout: 30_000 });
  // Titled the way the binder is shown, not left as the slug it is stored as.
  await expect(field).toHaveValue("Clinical Policies");

  await field.fill("Clinical Governance");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/${org}/clinical-governance\\?tab=settings$`),
    { timeout: 30_000 },
  );
  await expect(page.locator(".app-sidebar-binder-name")).toHaveText(
    "Clinical Governance",
  );

  // And the binder still holds what it held. Folders start shut, so the
  // drawer is opened the way a person opens it.
  await page.goto(`${APP_BASE_URL}/${org}/clinical-governance`);
  await openTreeFolder(page, "Nursing");
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toBeVisible({ timeout: 30_000 });
});

test("the rename field is not drawn for somebody who cannot use it", async ({
  page,
}) => {
  // A control that fails is worse than a control that is not there — the same
  // rule the tree follows for a file it cannot rename.
  const { session, org, binder } = await provision();

  const stranger = buildCredentials();
  const strangerSession = await signUp(stranger);
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: stranger.username, owner: false }),
  });
  expect(added.status, await added.text()).toBeLessThan(300);

  await signInBrowser(page, strangerSession);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=settings`);

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(0);
});
