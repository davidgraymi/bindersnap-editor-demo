/**
 * A binder shown the way a file explorer shows a folder.
 *
 * **Two things were wrong with the list this replaces.** Folders nest in a
 * binder — a document's address is a path and always has been — but the list
 * grouped by folder and printed the whole path as a heading, so
 * `nursing/infection` sat beside `nursing` with nothing saying one was inside
 * the other. And folders came from the documents, so a folder with nothing
 * filed in it was invisible: somebody made one, took it through a change
 * request, had it approved and published, and the binder showed no sign of it.
 *
 * The second of those is why this is an integration test. "An empty folder
 * appears" is a claim about a `.gitkeep` surviving a publish and coming back
 * out of a tree read — four pieces of real machinery, none of which a unit
 * test touches.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 240_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `tree-${suffix}`,
    email: `tree-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

function sessionFrom(response: Response): string {
  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  expect(match?.[1], "no session cookie in the response").toBeTruthy();
  return match![1]!;
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
  return sessionFrom(response);
}

async function createOrganization(session: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: `Riverbend ${randomUUID().slice(0, 6)}` }),
  });
  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: { name: string } }).organization
    .name;
}

async function createBinder(
  session: string,
  org: string,
  name = "Clinical Policies",
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name }),
  });
  const body = await response.text();
  expect(response.status, `create binder failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

/** File a policy, joining `change` when one is given. Answers its change. */
async function addPolicy(
  session: string,
  org: string,
  binder: string,
  name: string,
  folder: string,
  change?: number,
): Promise<number> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([`# ${name}\n\nThe policy text.\n`], { type: "text/markdown" }),
    `${name.toLowerCase().replace(/\s+/g, "-")}.md`,
  );
  form.set("name", name);
  form.set("folder", folder);
  if (change !== undefined) form.set("changeNumber", String(change));

  const response = await fetch(
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
  const body = await response.text();
  expect(response.status, `add ${name} failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { pullRequestNumber: number }).pullRequestNumber;
}

/** A second person approves it, and the author publishes it. */
async function approveAndPublish(
  session: string,
  org: string,
  binder: string,
  change: number,
): Promise<void> {
  const approver = buildCredentials();
  const approverSession = await signUp(approver);

  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: approver.username, owner: false }),
  });
  expect(added.status, await added.text()).toBeLessThan(300);

  // **Approve, then check it is still standing, and try again if not.** Gitea
  // processes a push asynchronously and dismisses approvals recorded against
  // the old head, so an approval can be accepted and be gone a second later —
  // which shows up as a publish failing with "does not have enough approvals"
  // immediately after a review returned 200. Only under the load of the full
  // suite, which is what makes it a flake rather than a bug.
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

/**
 * A binder holding a nested tree and one empty folder, all on the record.
 *
 * One change request for the lot, which is also the thing ADR 0004 §4 asks
 * for: five acts that belong together are approved together.
 */
async function provisionBinder(): Promise<{
  session: string;
  org: string;
  binder: string;
}> {
  const session = await signUp(buildCredentials());
  const org = await createOrganization(session);
  const binder = await createBinder(session, org);

  const change = await addPolicy(
    session,
    org,
    binder,
    "Hand Hygiene",
    "Nursing",
  );
  await addPolicy(
    session,
    org,
    binder,
    "Handover",
    "Nursing/Infection Control",
    change,
  );
  await addPolicy(session, org, binder, "Dispensing", "Pharmacy", change);
  await addPolicy(session, org, binder, "Staff Handbook", "", change);

  // A folder with nothing filed in it. This is the row the old list dropped.
  const folder = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/folders`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ folder: "Estates", changeNumber: change }),
    },
  );
  expect(folder.status, await folder.text()).toBe(201);

  await approveAndPublish(session, org, binder, change);
  return { session, org, binder };
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

test("the binder answers with its folders, empty ones included", async () => {
  const { session, org, binder } = await provisionBinder();

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const payload = (await response.json()) as {
    documents: Array<{ slugPath: string }>;
    folders: string[];
  };

  // Every level, including the one holding nothing and the one holding only
  // another folder.
  expect(payload.folders).toEqual([
    "estates",
    "nursing",
    "nursing/infection-control",
    "pharmacy",
  ]);
  expect(payload.documents.map((document) => document.slugPath)).toContain(
    "nursing/infection-control/handover",
  );
});

test("folders nest, and the tree says which is inside which", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  const tree = page.locator(".binder-tree");
  await expect(tree).toBeVisible({ timeout: 30_000 });

  // Folders before documents, each alphabetical, and `infection-control`
  // inside `nursing` rather than beside it.
  const rows = tree.locator(".binder-tree-label");
  // Folder names read like the documents under them — the binder stores
  // `infection-control`, and nobody typed that.
  await expect(rows).toHaveText([
    "Estates",
    "Nursing",
    "Infection Control",
    "Handover",
    "Hand Hygiene",
    "Pharmacy",
    "Dispensing",
    "Staff Handbook",
  ]);

  // Indentation is what carries the nesting, so it has to actually differ.
  // Measured on the label rather than the row: the indent is padding on the
  // row, so every row's own box starts at the same place and measuring those
  // would compare two identical numbers and prove nothing.
  const leftOf = (label: string) =>
    tree
      .locator(".binder-tree-label", { hasText: new RegExp(`^${label}$`) })
      .first()
      .evaluate((el) => el.getBoundingClientRect().left);

  const [nursing, infection, handover] = await Promise.all([
    leftOf("Nursing"),
    leftOf("Infection Control"),
    leftOf("Handover"),
  ]);
  expect(infection).toBeGreaterThan(nursing);
  expect(handover).toBeGreaterThan(infection);
});

test("an empty folder is in the binder, because somebody made it", async ({
  page,
}) => {
  // "Folders are real, empty or not." A folder taken through a change request,
  // approved and published, showing nothing at all is the act going missing.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  const estates = page
    .locator(".binder-tree-row")
    .filter({ hasText: "Estates" });
  await expect(estates).toBeVisible({ timeout: 30_000 });
  await expect(estates).toContainText("0 policies");
});

test("a folder shuts, and stays shut when you come back", async ({ page }) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  const nursing = page.getByRole("button", { name: /^Nursing/ });
  await expect(nursing).toBeVisible({ timeout: 30_000 });

  // Open to begin with — a policy manual is read by looking.
  await expect(nursing).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Hand Hygiene")).toBeVisible();

  await nursing.click();
  await expect(nursing).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Hand Hygiene")).toBeHidden();
  // What it is hiding, counted all the way down.
  await expect(nursing).toContainText("2 policies");

  // The preference is the person's, and it survives the page going away.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Nursing/ })).toHaveAttribute(
    "aria-expanded",
    "false",
    { timeout: 30_000 },
  );
});

test("shutting a folder in one binder does not shut it in another", async ({
  page,
}) => {
  // The preference is per binder: shutting the departments you do not work in
  // is a statement about that binder and nothing else.
  const { session, org, binder } = await provisionBinder();
  const second = await createBinder(session, org, "Corporate Policies");
  const change = await addPolicy(
    session,
    org,
    second,
    "Hand Hygiene",
    "Nursing",
  );
  await approveAndPublish(session, org, second, change);

  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  const nursing = page.getByRole("button", { name: /^Nursing/ });
  await expect(nursing).toBeVisible({ timeout: 30_000 });
  await nursing.click();
  await expect(nursing).toHaveAttribute("aria-expanded", "false");

  await page.goto(`${APP_BASE_URL}/${org}/${second}`);
  await expect(page.getByRole("button", { name: /^Nursing/ })).toHaveAttribute(
    "aria-expanded",
    "true",
    { timeout: 30_000 },
  );
});
