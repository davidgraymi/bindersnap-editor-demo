/**
 * Filing a policy through the browser, end to end.
 *
 * **This replaces `document-creation.pw.ts` and the four suites beside it.**
 * Those drove the per-document workspace — a document was a Gitea repository,
 * so creating one made a repo, protected its branch and installed its rules,
 * and the browser test walked that. ADR 0004 deleted that model: a document is
 * a file inside a binder that already has all of it, so the journey is a
 * shorter one and this is the shorter test.
 *
 * The API side of this is covered in `workspace-provisioning.pw.ts`, which is
 * where the assertions about paths, identity and versions live. What only a
 * browser can prove is that the two ways in actually reach the form — the
 * binder's own "Add a policy" and the nav's "New policy", which has to ask
 * which binder first — and that a policy filed this way shows up on the page
 * the person is looking at.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

// Signup, an organization, two binders and several page loads on a stack that
// may be cold. The suite default is nowhere near enough.
test.describe.configure({ mode: "serial", timeout: 180_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `addpolicy-${suffix}`,
    email: `addpolicy-${suffix}@users.bindersnap.local`,
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

function authHeaders(sessionCookie: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${sessionCookie}`,
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

async function createOrganization(
  sessionCookie: string,
  displayName: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name: displayName }),
  });
  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: { name: string } }).organization
    .name;
}

async function createBinder(
  sessionCookie: string,
  org: string,
  name: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ name }),
  });
  const body = await response.text();
  expect(response.status, `create binder failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

async function signInBrowser(page: Page, sessionCookie: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: sessionCookie, url: APP_BASE_URL },
    ]);
}

/** Fill the modal that is already open, and submit it. */
async function fileAPolicy(page: Page, name: string, folder: string) {
  await page.locator("#add-policy-file").setInputFiles({
    name: `${name.toLowerCase().replace(/\s+/g, "-")}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${name}\n\nThe policy text.\n`),
  });

  // The modal suggests a name from the file. Typing over it is what a person
  // does, and it is the field the document's identity comes from.
  await page.locator("#add-policy-name").fill(name);
  await page.locator("#add-policy-folder").fill(folder);

  await page.getByRole("button", { name: "Add policy", exact: true }).click();
}

test("a member files a policy from the binder's own page", async ({ page }) => {
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Riverbend ${randomUUID().slice(0, 6)}`,
  );
  const binder = await createBinder(sessionCookie, org, "Clinical Policies");

  await signInBrowser(page, sessionCookie);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  // An empty binder says so rather than showing a blank list.
  await expect(page.getByText("Nothing filed here yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add a policy" }).click();
  await expect(
    page.getByRole("heading", { name: "Add a policy" }),
  ).toBeVisible();

  await fileAPolicy(page, "Infection Control Policy", "nursing");

  // **The assertion that matters.** `main` is the record, so a policy filed a
  // moment ago is not in the tree — and a binder that silently omitted it
  // would look broken in the one moment somebody is watching. Filing opens the
  // document's own page, which says so in as many words.
  //
  // Matched on the heading rather than on the text: the landing page's mockup
  // markup is still in the DOM and carries "Infection Control Policy" in a
  // hidden element, so a bare text match finds the wrong one.
  // The document's own header, not the rendered file — the preview below it
  // shows the markdown's `# Infection Control Policy` as a heading too.
  // The last one: the binder's own header carries the same class above it, and
  // a document opens *under* that header rather than on a page of its own.
  await expect(page.locator("h1.doc-header-title").last()).toHaveText(
    "Infection Control Policy",
    { timeout: 30_000 },
  );
  await expect(
    page.getByText("This policy is not in the binder yet"),
  ).toBeVisible();
});

test("the nav's New policy asks which binder, then files into it", async ({
  page,
}) => {
  // The nav is the one surface with no binder in scope. Asking first is not a
  // nicety: the binder decides who can see the policy, who approves it and
  // what the rules are, and it is the one answer that cannot be changed
  // afterwards without re-filing.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Riverbend ${randomUUID().slice(0, 6)}`,
  );
  await createBinder(sessionCookie, org, "Clinical Policies");
  const second = await createBinder(sessionCookie, org, "Corporate Policies");

  await signInBrowser(page, sessionCookie);
  await page.goto(`${APP_BASE_URL}/${org}`);

  await page.locator("#topnav-new-doc-btn").click();

  await expect(
    page.getByRole("heading", { name: "Which binder?" }),
  ).toBeVisible();

  // Scoped to the dialog: the organization page behind it lists the same
  // binders, so an unscoped match finds two.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: second, exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add a policy" }),
  ).toBeVisible();

  await fileAPolicy(page, "Expenses Policy", "");

  // Wait for the app to land on the document before asking the API about it —
  // otherwise the fetch races the upload and reads an empty binder.
  await expect(page.locator("h1.doc-header-title").last()).toHaveText(
    "Expenses Policy",
    { timeout: 30_000 },
  );

  // It landed in the binder that was chosen, not the first one in the list.
  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${second}/documents`,
    { headers: { Cookie: `bindersnap_session=${sessionCookie}` } },
  );
  expect(documents.status).toBe(200);
  const listed = (await documents.json()) as {
    documents: Array<{ slugPath: string }>;
  };
  expect(listed.documents.map((document) => document.slugPath)).toContain(
    "expenses-policy",
  );
});

test("the library lists a policy across every binder it can reach", async ({
  page,
}) => {
  // The library was a search over Gitea repositories, because a document was
  // one. It is a walk over binders now, and this is the browser half of that:
  // one page, both binders, grouped by the thing that decides who can see
  // each policy.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Riverbend ${randomUUID().slice(0, 6)}`,
  );
  const clinical = await createBinder(sessionCookie, org, "Clinical Policies");
  const corporate = await createBinder(
    sessionCookie,
    org,
    "Corporate Policies",
  );

  await signInBrowser(page, sessionCookie);

  for (const [binder, name] of [
    [clinical, "Infection Control Policy"],
    [corporate, "Expenses Policy"],
  ] as const) {
    await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
    await page.getByRole("button", { name: "Add a policy" }).click();
    await fileAPolicy(page, name, "");
    await expect(page.locator("h1.doc-header-title").last()).toHaveText(name, {
      timeout: 30_000,
    });
  }

  await page.goto(`${APP_BASE_URL}/documents`);

  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: clinical, exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: corporate, exact: false }),
  ).toBeVisible();

  // Searching narrows it to one, which is the question the page exists for.
  await page
    .getByRole("searchbox", { name: "Search policies" })
    .fill("expenses");
  await expect(
    page.getByRole("heading", { name: clinical, exact: false }),
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: corporate, exact: false }),
  ).toBeVisible();
});

test("the binder's tabs still work once a document is open", async ({
  page,
}) => {
  // **The bug this guards.** A document opens under the binder's own header,
  // sharing its tab bar — and that tab bar moved the address bar without
  // telling the app, so the app kept rendering the document while the URL said
  // People. Every tab in the binder went dead the moment somebody clicked a
  // policy, which is the first thing anybody does here.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Riverbend ${randomUUID().slice(0, 6)}`,
  );
  const binderTitle = "Clinical Policies";
  const binder = await createBinder(sessionCookie, org, binderTitle);

  await signInBrowser(page, sessionCookie);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await page.getByRole("button", { name: "Add a policy" }).click();
  await fileAPolicy(page, "Hand Hygiene Policy", "nursing");

  await expect(page.locator("h1.doc-header-title").last()).toHaveText(
    "Hand Hygiene Policy",
    { timeout: 30_000 },
  );

  // Leaving the document by a tab, which is the act that was broken.
  await page.getByRole("tab", { name: "People" }).click();

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible({
    timeout: 30_000,
  });
  // The document is gone, not merely covered: the binder's header remains and
  // the document's does not.
  // The binder heads its own page by the name it was given, not by the slug
  // the repository is addressed by.
  await expect(page.locator("h1.doc-header-title")).toHaveText(binderTitle);
  expect(new URL(page.url()).pathname).toBe(`/${org}/${binder}`);

  // Who can act here is a question about people, not about billing. The seat
  // chip on every row and the "N people · N seats · N free" line above them
  // both said the same thing twice and neither belonged on this page.
  await expect(page.getByText(/\d+ seats? · \d+ free/)).toHaveCount(0);
  await expect(page.getByText("Seat", { exact: true })).toHaveCount(0);

  // And a second tab, to prove the first was not a one-off — plus the one
  // thing the sign-off page must never say. Gitea is our plumbing, and naming
  // it on a page a compliance manager reads explains nothing.
  await page.getByRole("tab", { name: "Sign-off rules" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign-off rules" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Gitea")).toHaveCount(0);
});

test("the header's one filled button belongs to the tab it sits above", async ({
  page,
}) => {
  // "Add a policy" is the header's only filled button, which makes it the most
  // emphatic thing on whatever page it sits above. It used to sit above all six
  // tabs — so on a change request awaiting a decision it competed with Approve,
  // and won on colour. It belongs to Documents and nowhere else.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const org = await createOrganization(
    sessionCookie,
    `Hierarchy ${randomUUID().slice(0, 6)}`,
  );
  const binder = await createBinder(sessionCookie, org, "Clinical Policies");

  await signInBrowser(page, sessionCookie);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  const addAPolicy = page.getByRole("button", { name: "Add a policy" });
  await expect(addAPolicy).toBeVisible();

  for (const tab of [
    "Change requests",
    "People",
    "Sign-off rules",
    "History",
    "Settings",
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(addAPolicy).toHaveCount(0, { timeout: 30_000 });
  }

  // Back to Documents and it returns: scoped, not deleted.
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(addAPolicy).toBeVisible({ timeout: 30_000 });

  // Filing a policy is never more than one click away regardless — the top
  // nav carries it on every page in the app.
  await expect(page.getByRole("button", { name: "New policy" })).toBeVisible();
});
