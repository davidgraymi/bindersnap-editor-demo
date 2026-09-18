/**
 * Editing a binder: a draft, the acts that go into it, and the change request
 * the author writes at the end.
 *
 * **What this is proving.** Every act on a binder used to open a change
 * request the instant it happened — rename a policy and three colleagues were
 * asked to decide on it before you had finished deciding what you were
 * proposing. Edit mode is the answer: press Edit, rearrange the binder as many
 * times as you like, and only then say what the whole thing was for, in your
 * own words.
 *
 * Integration rather than unit, because the claims are about real branches. "A
 * rename lands in the draft and not on the record" is a statement about two
 * git refs disagreeing, and "the tree shows what you just did" is a statement
 * about a tree read at a branch that exists for a few seconds. Neither is
 * reachable from a mock.
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
    username: `edit-${suffix}`,
    email: `edit-${suffix}@users.bindersnap.local`,
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

async function createBinder(session: string, org: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: "Clinical Policies" }),
  });
  const body = await response.text();
  expect(response.status, `create binder failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

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

/**
 * A second person approves it, and the author publishes it.
 *
 * Retried, because Gitea processes a push asynchronously and dismisses an
 * approval recorded against the old head — so a review can return 200 and be
 * gone a second later, which surfaces as "does not have enough approvals" on
 * the publish. Only under the load of a full suite run, which is what makes it
 * a flake rather than a bug. Same shape as the loop in `binder-tree.pw.ts`.
 */
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

/** A binder with two policies on the record, one of them in a folder. */
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
  await addPolicy(session, org, binder, "Staff Handbook", "", change);
  await approveAndPublish(session, org, binder, change);

  return { session, org, binder };
}

async function openDraft(
  session: string,
  org: string,
  binder: string,
): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    { method: "POST", headers: authHeaders(session), body: "{}" },
  );
  const body = await response.text();
  expect(response.status, `open draft failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { draft: { branch: string } }).draft.branch;
}

async function listDocuments(
  session: string,
  org: string,
  binder: string,
  draft?: string,
): Promise<{
  status: number;
  documents: Array<{ slugPath: string; name: string; uid: string | null }>;
  folders: string[];
  draft: string | null;
  error?: string;
}> {
  const query = draft ? `?draft=${encodeURIComponent(draft)}` : "";
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents${query}`,
    { headers: authHeaders(session) },
  );
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    documents: (body.documents ?? []) as Array<{
      slugPath: string;
      name: string;
      uid: string | null;
    }>,
    folders: (body.folders ?? []) as string[],
    draft: (body.draft ?? null) as string | null,
    error: body.error as string | undefined,
  };
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

// ── the binder, read at a draft ────────────────────────────────────

test("a rename is in your draft and not on the record", async () => {
  // The whole promise of edit mode in one assertion: the work is real, it is
  // committed, and nobody has been asked about it.
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  const renamed = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-renames`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        documentPath: "nursing/hand-hygiene",
        name: "Hand Hygiene and PPE",
        draft,
      }),
    },
  );
  const renamedBody = await renamed.text();
  expect(renamed.status, renamedBody).toBe(201);
  // No change request: that is what makes it a draft.
  expect(JSON.parse(renamedBody).changeNumber).toBeNull();

  const onDraft = await listDocuments(session, org, binder, draft);
  expect(onDraft.draft).toBe(draft);
  expect(onDraft.documents.map((entry) => entry.slugPath)).toContain(
    "nursing/hand-hygiene-and-ppe",
  );

  const onRecord = await listDocuments(session, org, binder);
  expect(onRecord.draft).toBeNull();
  expect(onRecord.documents.map((entry) => entry.slugPath)).toContain(
    "nursing/hand-hygiene",
  );
});

test("somebody else's draft is not yours to read", async () => {
  // "Other people's drafts are visible; their contents are not." Knowing
  // somebody is editing stops two people making the same folder twice; reading
  // their unproposed work is not what a draft offers.
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  const stranger = buildCredentials();
  const strangerSession = await signUp(stranger);
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: stranger.username, owner: false }),
  });
  expect(added.status, await added.text()).toBeLessThan(300);

  const refused = await listDocuments(strangerSession, org, binder, draft);
  expect(refused.status).toBe(409);
  expect(refused.error).toMatch(/not yours/i);
});

test("a draft that is gone is refused rather than quietly answered", async () => {
  // A stale `?edit=1` link, or a draft discarded in another tab. The binder is
  // there and readable; what failed is the claim about the draft — so it is a
  // 409, and the page drops out of edit mode on it.
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  const discarded = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    { method: "DELETE", headers: authHeaders(session) },
  );
  expect(discarded.status, await discarded.text()).toBe(200);

  const stale = await listDocuments(session, org, binder, draft);
  expect(stale.status).toBe(409);
});

// ── edit mode in the browser ───────────────────────────────────────

test("Edit opens a draft, and the address says so", async ({ page }) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  // Nothing about drafts until somebody asks for one.
  await expect(page.locator(".bs-draftbar")).toBeHidden();

  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const bar = page.locator(".bs-draftbar");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toContainText("Nothing in your draft yet");
  // In the address, so a reload lands back in the same work.
  await expect(page).toHaveURL(/\?edit=1$/);

  // Propose is off with nothing to propose: a change request with no changes
  // in it is a request nobody can act on.
  await expect(page.getByRole("button", { name: "Propose" })).toBeDisabled();
});

test("a rename in the tree lands in the draft, and the row keeps it", async ({
  page,
}) => {
  // Continuous save, which is what the customer asked for: "That way we can
  // save everything continuously and when they are ready open a CR."
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?edit=1`);

  // `?edit=1` with no draft drops back out rather than conjuring one — so the
  // draft is opened through the button, the way a person would.
  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Rename Hand Hygiene" }).click();
  const box = page.getByRole("textbox", { name: "New name" });
  await expect(box).toBeFocused();
  await box.fill("Hand Hygiene and PPE");
  await box.press("Enter");

  // The row says what was written — titled the way the tree titles every
  // name, which is where the stray "And" comes from.
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene And PPE" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".bs-draftbar")).toContainText("1 change");

  // And the record is untouched, which is the half a screenshot cannot show.
  const onRecord = await listDocuments(session, org, binder);
  expect(onRecord.documents.map((entry) => entry.name)).toContain(
    "hand-hygiene",
  );
});

test("Escape leaves the name alone", async ({ page }) => {
  // Blur commits, so cancelling has to win the race against its own blur —
  // otherwise Escape would commit the edit it just abandoned.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Rename Staff Handbook" }).click();
  const box = page.getByRole("textbox", { name: "New name" });
  await box.fill("Something Else Entirely");
  await box.press("Escape");

  await expect(
    page.locator(".binder-tree-label", { hasText: "Staff Handbook" }),
  ).toBeVisible();
  await expect(page.locator(".bs-draftbar")).toContainText(
    "Nothing in your draft yet",
  );
});

test("Propose opens the change request, with the words the author wrote", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Rename Hand Hygiene" }).click();
  const box = page.getByRole("textbox", { name: "New name" });
  await box.fill("Hand Hygiene and PPE");
  await box.press("Enter");
  await expect(page.locator(".bs-draftbar")).toContainText("1 change", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Propose" }).click();
  await expect(page).toHaveURL(/\?edit=propose$/);

  // The description arrives written: the acts are the commits, and nobody
  // should have to retype what they just did.
  const description = page.getByRole("textbox", { name: /^Why/ });
  await expect(description).toContainText(/Hand Hygiene/);

  // The title does not, because "what is this change for" is the one thing no
  // planner can write — so the button stays off until it is answered.
  await expect(
    page.getByRole("button", { name: "Open the change request" }),
  ).toBeDisabled();

  await page
    .getByRole("textbox", { name: "What you are asking for" })
    .fill("Bring the hand hygiene policy in line with the PPE guidance");
  await page.getByRole("button", { name: "Open the change request" }).click();

  // Straight to the change request it became, under the author's own title.
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });
  await expect(
    page.getByText(
      "Bring the hand hygiene policy in line with the PPE guidance",
    ),
  ).toBeVisible({ timeout: 30_000 });
});

test("Discard throws the draft away and leaves the binder as it was", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Rename Hand Hygiene" }).click();
  const box = page.getByRole("textbox", { name: "New name" });
  await box.fill("Hand Hygiene and PPE");
  await box.press("Enter");
  await expect(page.locator(".bs-draftbar")).toContainText("1 change", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Discard" }).click();

  await expect(page.locator(".bs-draftbar")).toBeHidden({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/${org}/${binder}$`));
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toBeVisible();

  // Nothing was proposed on the way out. Discarding is not a quiet way to open
  // a change request.
  const changes = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes?state=open`,
    { headers: authHeaders(session) },
  );
  const body = (await changes.json()) as { changes: unknown[] };
  expect(body.changes).toHaveLength(0);
});

// ── moving things ──────────────────────────────────────────────────

/** Make a folder in the binder's draft. */
async function makeFolder(
  session: string,
  org: string,
  binder: string,
  folder: string,
  draft: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/folders`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ folder, draft }),
    },
  );
  expect(
    response.status,
    `make ${folder} failed: ${await response.text()}`,
  ).toBe(201);
}

/** The act summaries on the draft, newest first. */
async function draftActs(
  session: string,
  org: string,
  binder: string,
): Promise<string[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    { headers: authHeaders(session) },
  );
  const body = (await response.json()) as {
    draft: { acts: Array<{ summary: string }> } | null;
  };
  return (body.draft?.acts ?? []).map((act) => act.summary);
}

test("a policy dragged onto a folder is filed there", async ({ page }) => {
  // The customer's words: "Moving a document should be a simple drag and
  // drop." This is that sentence, against a real binder.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  const handbook = page
    .locator(".binder-tree-row")
    .filter({ hasText: "Staff Handbook" });
  const nursing = page
    .locator(".binder-tree-row--folder")
    .filter({ hasText: "Nursing" });

  await handbook.dragTo(nursing);

  await expect(page.locator(".bs-draftbar")).toContainText("1 change", {
    timeout: 30_000,
  });
  expect(await draftActs(session, org, binder)).toEqual([
    "Move Staff Handbook to Nursing",
  ]);

  // And it is where it says it is, on the draft and not on the record.
  const draft = await openDraft(session, org, binder);
  const onDraft = await listDocuments(session, org, binder, draft);
  expect(onDraft.documents.map((entry) => entry.slugPath)).toContain(
    "nursing/staff-handbook",
  );
  const onRecord = await listDocuments(session, org, binder);
  expect(onRecord.documents.map((entry) => entry.slugPath)).toContain(
    "staff-handbook",
  );
});

test("a folder dragged onto another takes everything in it", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);
  await makeFolder(session, org, binder, "Clinical", draft);

  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?edit=1`);
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page
    .locator(".binder-tree-row--folder")
    .filter({ hasText: "Nursing" })
    .dragTo(
      page.locator(".binder-tree-row--folder").filter({ hasText: "Clinical" }),
    );

  await expect(page.locator(".bs-draftbar")).toContainText("2 changes", {
    timeout: 30_000,
  });
  expect(await draftActs(session, org, binder)).toEqual([
    "Move the folder Nursing to Clinical / Nursing",
    "Add the folder Clinical",
  ]);

  // The policy inside it moved with it, which is the half that would be a
  // disaster to get wrong.
  const onDraft = await listDocuments(session, org, binder, draft);
  expect(onDraft.documents.map((entry) => entry.slugPath)).toContain(
    "clinical/nursing/hand-hygiene",
  );
});

test("a folder cannot be dropped inside itself", async ({ page }) => {
  // Every file under it would land at a path that is about to stop existing.
  // Refused in the browser as well as on the server, so the row never lights
  // up — a drop that is going to fail should not look like one that will work.
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);
  await makeFolder(session, org, binder, "Nursing/Infection Control", draft);

  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?edit=1`);
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page
    .locator(".binder-tree-row--folder")
    .filter({ hasText: "Nursing" })
    .first()
    .dragTo(
      page
        .locator(".binder-tree-row--folder")
        .filter({ hasText: "Infection Control" }),
    );

  // Still one act — the folder that was made — and no second one.
  expect(await draftActs(session, org, binder)).toEqual([
    "Add the folder Nursing / Infection Control",
  ]);
});

test("the Move button files something without a pointer", async ({ page }) => {
  // Drag and drop needs both ends of the move on screen and is unreachable
  // from a keyboard. A binder with forty folders and a scrollbar is the
  // ordinary case, so there is a second way and it is not a fallback.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Move Staff Handbook" }).click();
  await page
    .getByRole("combobox", { name: "Where it goes" })
    .selectOption("nursing");
  await page.getByRole("button", { name: "Move", exact: true }).click();

  await expect(page.locator(".bs-draftbar")).toContainText("1 change", {
    timeout: 30_000,
  });
  expect(await draftActs(session, org, binder)).toEqual([
    "Move Staff Handbook to Nursing",
  ]);
});

test("a policy dragged out of its folder lands at the top level", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  // The root zone only exists while something is in the air, so the drag has
  // to be driven by hand rather than by `dragTo`.
  const hygiene = page
    .locator(".binder-tree-row")
    .filter({ hasText: "Hand Hygiene" });
  await hygiene.hover();
  await page.mouse.down();
  await page.mouse.move(400, 600, { steps: 10 });

  const zone = page.locator(".binder-tree-root-drop");
  await expect(zone).toBeVisible();
  await zone.hover();
  await page.mouse.up();

  await expect(page.locator(".bs-draftbar")).toContainText("1 change", {
    timeout: 30_000,
  });
  expect(await draftActs(session, org, binder)).toEqual([
    "Move Hand Hygiene to the binder’s top level",
  ]);
});

test("the binder's list carries each policy's identity", async () => {
  // Edit mode needs it to know which rows it may offer a pencil on: a file
  // this product did not write has no identity segment, cannot be renamed, and
  // must not be drawn as though it can. The list payload did not carry it
  // until drag-to-move needed it — the rule is unit-tested in
  // `apps/app/binderMove.test.ts`; this is the half that has to survive a real
  // tree read.
  const { session, org, binder } = await provisionBinder();

  const listed = await listDocuments(session, org, binder);
  const hygiene = listed.documents.find(
    (entry) => entry.slugPath === "nursing/hand-hygiene",
  ) as { uid?: string | null } | undefined;

  expect(hygiene).toBeTruthy();
  // A ULID — 26 characters of Crockford base32, which is what the version tags
  // are named after.
  expect(hygiene!.uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});
