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

import {
  API_BASE_URL,
  APP_BASE_URL,
  openBinderSection,
  openTreeFolder,
} from "./helpers";

// Signup, an organization, two binders and several page loads on a stack that
// may be cold. The suite default is nowhere near enough.
test.describe.configure({ mode: "parallel", timeout: 180_000 });

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
  // The folder is a picker of the folders that exist, plus the way to make
  // one — which is what a binder's first policy needs. Empty means the
  // binder's top level, which is what the picker already says.
  if (folder !== "") {
    await page
      .locator("#add-policy-folder")
      .selectOption({ label: "A new folder…" });
    await page.locator("#add-policy-new-folder").fill(folder);
  }

  await page.getByRole("button", { name: "Add document", exact: true }).click();
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

  await page.getByRole("button", { name: "Add a document" }).click();
  await expect(
    page.getByRole("heading", { name: "Add a document" }),
  ).toBeVisible();

  await fileAPolicy(page, "Infection Control Policy", "nursing");

  // **The assertion that matters.** Filing a policy does not put it in the
  // binder — it opens a change request, and that is where this lands. Landing
  // on the document's page made the act look finished; a change request is
  // what actually happened and what has to be decided next.
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });
  // The change's own screen: the document it proposes, and the way back to
  // the list. Not "Publish", which a change with no approvals yet does not
  // offer.
  await expect(
    page.locator(".change-does").getByText("Infection Control Policy"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".page-path").getByRole("link", { name: "Change requests" }),
  ).toBeVisible();

  // And the binder still holds nothing, because nothing has been published.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await expect(page.getByText("Nothing filed here yet.")).toBeVisible({
    timeout: 30_000,
  });
});

/**
 * Approve and publish the one open change in a binder, as somebody else.
 *
 * The library lists what is on `main`, so a policy filed a moment ago is not
 * in it — which is the point of that rule, and means a test about the library
 * has to get its policies onto the record first. An author cannot approve
 * their own change, so this signs a second person up and grants them the
 * binder's reviewer team.
 */
async function publishTheOpenChange(
  sessionCookie: string,
  org: string,
  binder: string,
): Promise<void> {
  const open = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes?state=open`,
    { headers: authHeaders(sessionCookie) },
  );
  const { changes } = (await open.json()) as {
    changes: Array<{ number: number }>;
  };
  expect(changes, "no open change to publish").toHaveLength(1);
  const number = changes[0]!.number;

  const approver = buildCredentials();
  const approverCookie = await signUp(approver);
  // Into the organization, which grants `staff` — the team a binder is already
  // open to. A binder manufactures no teams of its own, so there is no
  // per-binder reviewer role to add them to.
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(sessionCookie),
    body: JSON.stringify({ username: approver.username, owner: false }),
  });
  expect(added.status, await added.text()).toBeLessThan(300);

  expect(
    (
      await fetch(
        `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${number}/reviews`,
        {
          method: "POST",
          headers: authHeaders(approverCookie),
          body: JSON.stringify({ event: "APPROVE" }),
        },
      )
    ).status,
  ).toBe(200);

  const published = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${number}/publish`,
    { method: "POST", headers: authHeaders(sessionCookie), body: "{}" },
  );
  expect(published.status, await published.text()).toBe(200);
}

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
    await page.getByRole("button", { name: "Add a document" }).click();
    await fileAPolicy(page, name, "");
    // Filing opens a change request, which is where it lands.
    await expect(page).toHaveURL(/tab=changes&change=\d+/, {
      timeout: 30_000,
    });
    // Onto `main`, because the library lists the record and nothing else.
    await publishTheOpenChange(sessionCookie, org, binder);
  }

  await page.goto(`${APP_BASE_URL}/documents`);

  // **Exact**, because this is the page's own title. Substring matching also
  // catches the rail heading of every binder whose name ends in "policies",
  // so the assertion passed until the stack had two of them and then failed
  // on a strict-mode violation about data the test never created.
  // **Named for the entry that opens it.** It was "Policies" while the
  // navigation said "Documents", so the page a reader arrived at was not the
  // page they had clicked.
  await expect(
    page.getByRole("heading", { name: "Documents", exact: true }),
  ).toBeVisible();
  // Each binder heads its own panel, titled the way the binder is everywhere
  // else, and the heading is the way into it. One organization, so the name
  // alone: the organization only appears when it tells two binders apart.
  await expect(
    page.getByRole("heading", { name: "Clinical Policies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Corporate Policies", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Clinical Policies", exact: true }),
  ).toHaveAttribute("href", `/${org}/${clinical}`);

  // Searching narrows it to one, which is the question the page exists for.
  await page
    .getByRole("searchbox", { name: "Search documents" })
    .fill("expenses");
  await expect(
    page.getByRole("heading", { name: "Clinical Policies", exact: true }),
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Corporate Policies", exact: true }),
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
  await page.getByRole("button", { name: "Add a document" }).click();
  await fileAPolicy(page, "Hand Hygiene Policy", "nursing");
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });

  // Published, because a binder lists the record — and a document is opened by
  // clicking it in that list, which is the journey this test is about.
  await publishTheOpenChange(sessionCookie, org, binder);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  // It was filed in Nursing, and folders start shut — so the drawer is opened
  // first, the same way a person reaches it.
  await openTreeFolder(page, "Nursing");
  // A link, the way a file in a code host's tree is: it opens in a tab.
  await page
    .getByRole("link", { name: "Hand Hygiene Policy" })
    .click({ timeout: 30_000 });

  await expect(page.locator("h1.bs-title").last()).toHaveText(
    "Hand Hygiene Policy",
    { timeout: 30_000 },
  );

  // Leaving the document by the sidebar, which is where the binder's own
  // screens live now. People is a section of Settings, not a screen of its own.
  await openBinderSection(page, "Settings");

  await expect(page.getByRole("heading", { name: "People" })).toBeVisible({
    timeout: 30_000,
  });
  // The document is gone, not merely covered: the page is Settings now, and
  // the binder is named once, in the sidebar, by the name it was given rather
  // than by the slug the repository is addressed by.
  await expect(page.locator("h1.bs-title")).toHaveText("Settings");
  await expect(page.locator(".app-sidebar-binder-name")).toHaveText(
    binderTitle,
  );
  expect(new URL(page.url()).pathname).toBe(`/${org}/${binder}`);

  // Who can act here is a question about people, not about billing. The seat
  // chip on every row and the "N people · N seats · N free" line above them
  // both said the same thing twice and neither belonged on this page.
  await expect(page.getByText(/\d+ seats? · \d+ free/)).toHaveCount(0);
  await expect(page.getByText("Seat", { exact: true })).toHaveCount(0);

  // Sign-off rules are on the same page — plus the one thing that section must
  // never say. Gitea is our plumbing, and naming it on a page a compliance
  // manager reads explains nothing.
  await expect(
    page.getByRole("heading", { name: "Sign-off rules" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#sign-off").getByText("Gitea")).toHaveCount(0);

  // And a second screen, to prove the first was not a one-off.
  await openBinderSection(page, "History");
  await expect(page.getByRole("heading", { name: "People" })).toHaveCount(0, {
    timeout: 30_000,
  });
});

test("the header's one filled button belongs to the tab it sits above", async ({
  page,
}) => {
  // "Add a policy" is the header's only filled button, which makes it the most
  // emphatic thing on whatever page it sits above. It used to sit above every
  // tab — so on a change request awaiting a decision it competed with Approve,
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

  const addAPolicy = page.getByRole("button", { name: "Add a document" });
  await expect(addAPolicy).toBeVisible();

  for (const section of ["Change requests", "History", "Settings"] as const) {
    await openBinderSection(page, section);
    await expect(addAPolicy).toHaveCount(0, { timeout: 30_000 });
  }

  // Back to the binder's contents and it returns: scoped, not deleted.
  await page.locator(".app-sidebar-binder").click();
  await expect(addAPolicy).toBeVisible({ timeout: 30_000 });
});

test("a new binder has a page of its own, and lands you in it", async ({
  page,
}) => {
  // GitLab's "Create blank project": an address, a form that says what the
  // binder's address will be, and the new binder as where you end up.
  const credentials = buildCredentials();
  const sessionCookie = await signUp(credentials);
  const displayName = `Riverbend ${randomUUID().slice(0, 6)}`;
  const org = await createOrganization(sessionCookie, displayName);
  await createBinder(sessionCookie, org, "Corporate Policies");

  await signInBrowser(page, sessionCookie);
  await page.goto(`${APP_BASE_URL}/${org}`);
  await page.getByRole("link", { name: "New binder" }).click();

  await expect(page).toHaveURL(new RegExp(`/${org}\\?new=binder$`));
  await expect(page.locator("h1.bs-title")).toHaveText("New binder");
  // Named the way people read it, not by its slug.
  await expect(page.getByText(`Everyone at ${displayName}`)).toBeVisible();

  const name = page.getByLabel("Binder name");
  const create = page.getByRole("button", { name: "Create binder" });

  // A name another binder already has is refused before anything is sent.
  await name.fill("corporate policies");
  await expect(page.locator("#new-binder-address")).toContainText(
    `already has a binder at /${org}/corporate-policies`,
  );
  await expect(create).toBeDisabled();

  await name.fill("Clinical Policies");
  await expect(page.locator("#new-binder-address")).toContainText(
    `/${org}/clinical-policies`,
  );
  await page.getByLabel("Description").fill("Nursing and infection control.");
  await page.getByText("Only people you add").click();
  await create.click();

  await expect(page).toHaveURL(new RegExp(`/${org}/clinical-policies$`), {
    timeout: 30_000,
  });
  await expect(page.locator("h1.bs-title")).toHaveText("Clinical Policies");
  await expect(page.locator(".bs-subtitle").first()).toHaveText(
    "Nursing and infection control.",
  );

  // Cancel is a way back to the list, not a toggle in the header.
  await page.goto(`${APP_BASE_URL}/${org}?new=binder`);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`/${org}$`));
  await expect(
    page.getByRole("link", { name: "Clinical Policies" }),
  ).toBeVisible();
});
