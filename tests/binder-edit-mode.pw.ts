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
  await expect(bar).toContainText("Nothing in it yet");
  // Named from the moment it exists, so the bar, the picker and the propose
  // screen never invent one between them and disagree (D8).
  await expect(bar).toContainText("You are editing");
  // In the address, and *which* draft — a person may have several, so a
  // reload, a back button and a pasted link all have to land in the same work.
  await expect(page).toHaveURL(/\?edit=1&draft=draft%2F/);

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
  await expect(page.locator(".bs-draftbar")).toContainText("Nothing in it yet");
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
  // Which draft is being proposed, because a person may have several.
  await expect(page).toHaveURL(/\?edit=propose&draft=draft%2F/);

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

/**
 * A policy renamed in a draft still opens.
 *
 * **The customer hit this on a document sitting in front of them:** *"While
 * editing a binder if I rename a document and then click on it to open it an
 * error pops up that the document doesn't exist. This should not be the case.
 * There should be a branch with this document."*
 *
 * There is, and that was the whole of it: the tree in edit mode shows the
 * draft's names, and the page it opened asked `main` — which has never heard
 * of the new address, and said so.
 */
test("a policy renamed in a draft opens at the name it was renamed to", async () => {
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  await fetch(
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

  const address = `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents/nursing%2Fhand-hygiene-and-ppe`;

  // On `main` that address does not exist, and saying so is correct.
  const onRecord = await fetch(address, { headers: authHeaders(session) });
  expect(onRecord.status).toBe(404);

  const inDraft = await fetch(`${address}?draft=${encodeURIComponent(draft)}`, {
    headers: authHeaders(session),
  });
  expect(inDraft.status, await inDraft.clone().text()).toBe(200);
  const body = (await inDraft.json()) as {
    document: { slugPath: string };
    ref: string;
  };
  expect(body.document.slugPath).toBe("nursing/hand-hygiene-and-ppe");
  // Read on the branch that holds it, so the file behind it reads too.
  expect(body.ref).toBe(draft);
});

/** And in the browser, which is where it was reported. */
test("clicking a renamed policy in the tree opens it, not an error", async ({
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

  const row = page.locator(".binder-tree-label", {
    hasText: "Hand Hygiene And PPE",
  });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  // The document's own page, under the name it was just given. The page's own
  // heading, not the one inside the policy: a rendered Markdown policy opens
  // with its own `# Hand Hygiene`, so once the preview lands there are two and
  // `.app-main h1` is a strict-mode violation rather than an assertion.
  await expect(
    page.locator(".app-main h1:not(.doc-preview-prose h1)"),
  ).toHaveText("Hand Hygiene And PPE", { timeout: 30_000 });
  await expect(page.locator(".app-main")).not.toContainText("No such document");
  // Still editing, which is also the way back to what they were doing.
  expect(page.url()).toContain("edit=1");
});

/**
 * Comparing a change that renamed the policy it changed.
 *
 * **Also reported:** *"When I click compare on a renamed document an error
 * pops up saying the document doesn't exist."* The comparison reads two refs —
 * the proposed version on the change's branch, and the version it replaces on
 * the base — and a rename gives one document two addresses. The base has never
 * heard of the new one.
 *
 * The identity is what is the same at both refs (ADR 0005), and it rides in
 * the filename, so the file operations address the document by its path rather
 * than by where it is filed.
 */
test("the version a rename replaces is still readable at the base", async () => {
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  await fetch(
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

  const [renamed] = (await listDocuments(session, org, binder, draft)).documents
    .filter((entry) => entry.slugPath === "nursing/hand-hygiene-and-ppe")
    .map((entry) => entry.uid);
  expect(renamed).toBeTruthy();

  // The file path, which carries the identity — what the change page sends.
  const onDraft = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents/nursing%2Fhand-hygiene-and-ppe?draft=${encodeURIComponent(draft)}`,
    { headers: authHeaders(session) },
  );
  const { document } = (await onDraft.json()) as {
    document: { path: string };
  };

  // Asked at `main`, where the policy is still called Hand Hygiene. The
  // address is unknown there and the identity is not.
  const atBase = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/${document.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=main`,
    { headers: authHeaders(session) },
  );
  expect(atBase.status, await atBase.clone().text()).toBe(200);
});

// ── Several drafts (D8) ────────────────────────────────────────────────────

/** The draft payload, which now carries every draft of yours. */
async function readDrafts(
  session: string,
  org: string,
  binder: string,
  branch?: string,
): Promise<{
  draft: { branch: string; name: string } | null;
  drafts: Array<{ branch: string; name: string; actCount: number }>;
  others: Array<{ owner: string }>;
}> {
  const query = branch ? `?draft=${encodeURIComponent(branch)}` : "";
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft${query}`,
    { headers: authHeaders(session) },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as never;
}

async function startNamedDraft(
  session: string,
  org: string,
  binder: string,
  name: string,
): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ name }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { draft: { branch: string } }).draft
    .branch;
}

/**
 * **Pressing Edit still resumes.** That is not a detail to preserve out of
 * caution — accidental forks are the mistake the one-draft rule existed to
 * prevent, and they still are. What changes is that forking is now available
 * *deliberately*, with a name attached.
 */
test("pressing Edit twice resumes, and does not fork", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  const again = await openDraft(session, org, binder);
  expect(again).toBe(first);

  const { drafts } = await readDrafts(session, org, binder);
  expect(drafts).toHaveLength(1);
});

/**
 * Two unrelated reorganisations should not have to be proposed in one change
 * request, and approved or refused together, just because the same person did
 * both. That is D8, and it is the customer's decision rather than ours.
 */
test("a named draft is a second one, alongside the first", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  const second = await startNamedDraft(
    session,
    org,
    binder,
    "Retire the paper forms",
  );
  expect(second).not.toBe(first);

  const { drafts } = await readDrafts(session, org, binder);
  expect(drafts).toHaveLength(2);
  expect(drafts.map((entry) => entry.name)).toContain("Retire the paper forms");
});

/** A draft with no name is the state this exists to avoid. */
test("a draft started with an empty name is refused", async () => {
  const { session, org, binder } = await provisionBinder();

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ name: "   " }),
    },
  );
  expect(response.status).toBe(400);
});

/** Which draft you are in is the address's to say, and the read follows it. */
test("the read answers with the draft it was asked for", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  const second = await startNamedDraft(session, org, binder, "The other one");

  expect((await readDrafts(session, org, binder, first)).draft?.branch).toBe(
    first,
  );
  expect((await readDrafts(session, org, binder, second)).draft?.branch).toBe(
    second,
  );
  // Unasked is the newest, which is what it meant when there was only one.
  expect((await readDrafts(session, org, binder)).draft?.branch).toBe(second);
});

/**
 * A read, so a branch it cannot serve falls back rather than failing.
 *
 * Landing somebody in their most recent work beats an error about a branch
 * name they never typed — a stale link or a discarded draft is the ordinary
 * case, not a fault.
 */
test("a draft that is not yours is not served, and not an error either", async () => {
  const { session, org, binder } = await provisionBinder();
  const mine = await openDraft(session, org, binder);

  const { draft } = await readDrafts(
    session,
    org,
    binder,
    "draft/someone-else/20260101000000",
  );
  expect(draft?.branch).toBe(mine);
});

test("a draft can be called something else", async () => {
  const { session, org, binder } = await provisionBinder();
  const branch = await openDraft(session, org, binder);

  const renamed = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    {
      method: "PATCH",
      headers: authHeaders(session),
      body: JSON.stringify({ draft: branch, name: "Reorganise nursing" }),
    },
  );
  expect(renamed.status, await renamed.clone().text()).toBe(200);

  const { drafts } = await readDrafts(session, org, binder);
  expect(drafts[0]?.name).toBe("Reorganise nursing");
});

/** Renaming somebody else's is the same refusal every draft route makes. */
test("renaming a draft that is not yours is refused", async () => {
  const { session, org, binder } = await provisionBinder();

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    {
      method: "PATCH",
      headers: authHeaders(session),
      body: JSON.stringify({
        draft: "draft/someone-else/20260101000000",
        name: "Mine now",
      }),
    },
  );
  expect(response.status).toBe(409);
});

/**
 * **Each draft is its own branch, and the acts stay where they were made.**
 * The whole reason for several drafts: two reorganisations that do not travel
 * together.
 */
test("an act in one draft is not in the other", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  const second = await startNamedDraft(session, org, binder, "The other one");

  await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-renames`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        documentPath: "nursing/hand-hygiene",
        name: "Hand Hygiene and PPE",
        draft: first,
      }),
    },
  );

  const inFirst = await listDocuments(session, org, binder, first);
  expect(inFirst.documents.map((entry) => entry.slugPath)).toContain(
    "nursing/hand-hygiene-and-ppe",
  );

  const inSecond = await listDocuments(session, org, binder, second);
  expect(inSecond.documents.map((entry) => entry.slugPath)).toContain(
    "nursing/hand-hygiene",
  );
  expect(inSecond.documents.map((entry) => entry.slugPath)).not.toContain(
    "nursing/hand-hygiene-and-ppe",
  );
});

/** Discarding the one you are in must not take the other with it. */
test("discarding one draft leaves the others alone", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  const second = await startNamedDraft(session, org, binder, "The other one");

  const discarded = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft?draft=${encodeURIComponent(second)}`,
    { method: "DELETE", headers: authHeaders(session) },
  );
  expect(discarded.status, await discarded.clone().text()).toBe(200);

  const { drafts } = await readDrafts(session, org, binder);
  expect(drafts.map((entry) => entry.branch)).toEqual([first]);
});

/**
 * And proposing proposes the one you were looking at.
 *
 * Proposing the newest instead would send unrelated work to reviewers under a
 * title written about something else.
 */
test("proposing sends the draft it was asked to send", async () => {
  const { session, org, binder } = await provisionBinder();

  const first = await openDraft(session, org, binder);
  await startNamedDraft(session, org, binder, "The newer one");

  await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-renames`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        documentPath: "nursing/hand-hygiene",
        name: "Hand Hygiene and PPE",
        draft: first,
      }),
    },
  );

  const proposed = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        title: "Rename hand hygiene",
        draft: first,
      }),
    },
  );
  expect(proposed.status, await proposed.clone().text()).toBe(201);
  expect(((await proposed.json()) as { branch: string }).branch).toBe(first);

  // The proposed one stops being a draft; the other is untouched.
  const { drafts } = await readDrafts(session, org, binder);
  expect(drafts.map((entry) => entry.branch)).not.toContain(first);
  expect(drafts).toHaveLength(1);
});
