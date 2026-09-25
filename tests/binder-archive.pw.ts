/**
 * Archiving a policy — taking it off the record without destroying it.
 *
 * **The customer's word, and the accurate one:** *"delete should be allowed,
 * but I think it should be called archive because delete has connotations."*
 * The file leaves `main` and nothing else happens to it. Every version tag
 * still points at the commit that held it, git never collects a commit
 * reachable from a ref, and the bytes stay readable from a bare clone at every
 * version the policy ever reached.
 *
 * **Integration rather than unit, because the claim is about refs.** "The
 * archive lists it" is a set difference over a tree read and a tag read;
 * "nothing was destroyed" is a statement about a blob still being reachable
 * from a tag after the commit that held it left `main`. Neither is a thing a
 * mock can be wrong about convincingly.
 *
 * They also cover the design that was **not** built. The customer raised, and
 * agreed against, archived files being pushed to a separate `archive` branch
 * by a second hidden change; the reasons are in `docs/handoff-binder-editing.md`
 * and the short one is that two merges which must both succeed can half-apply.
 * `no second branch is made` is that decision, asserted.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, openTreeFolder } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 240_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `arch-${suffix}`,
    email: `arch-${suffix}@users.bindersnap.local`,
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
 * gone a second later, surfacing as "does not have enough approvals" on the
 * publish. Same shape as the loop in `binder-tree.pw.ts`.
 */
async function approveAndPublish(
  session: string,
  org: string,
  binder: string,
  change: number,
  approverSession?: string,
): Promise<Record<string, unknown>> {
  let approver = approverSession;
  if (!approver) {
    const credentials = buildCredentials();
    approver = await signUp(credentials);
    const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ username: credentials.username, owner: false }),
    });
    expect(added.status, await added.text()).toBeLessThan(300);
  }

  let published: Response | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const review = await fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
      {
        method: "POST",
        headers: authHeaders(approver),
        body: JSON.stringify({ event: "APPROVE" }),
      },
    );
    expect(review.status, await review.text()).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    published = await fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/publish`,
      { method: "POST", headers: authHeaders(session), body: "{}" },
    );
    if (published.status === 200) {
      return (await published.json()) as Record<string, unknown>;
    }
  }

  expect(
    published?.status,
    `publish never succeeded: ${await published?.text()}`,
  ).toBe(200);
  return {};
}

/** A binder with two published policies, one of them on its second version. */
async function provisionBinder(): Promise<{
  session: string;
  org: string;
  binder: string;
}> {
  const session = await signUp(buildCredentials());
  const org = await createOrganization(session);
  const binder = await createBinder(session, org);

  const first = await addPolicy(
    session,
    org,
    binder,
    "Hand Hygiene",
    "Nursing",
  );
  await addPolicy(session, org, binder, "Staff Handbook", "", first);
  await approveAndPublish(session, org, binder, first);

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
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { draft: { branch: string } }).draft
    .branch;
}

async function archive(
  session: string,
  org: string,
  binder: string,
  documentPath: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-archives`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ documentPath, ...body }),
    },
  );
}

async function readArchive(
  session: string,
  org: string,
  binder: string,
  /** Take the difference against your own draft rather than against `main`. */
  draft?: string,
): Promise<
  Array<{
    uid: string;
    title: string;
    slugPath: string | null;
    lastVersion: number;
    archivedAt: string | null;
    archivings: number | null;
  }>
> {
  const query = draft ? `?draft=${encodeURIComponent(draft)}` : "";
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/archive${query}`,
    { headers: authHeaders(session) },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { documents: [] }).documents;
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

// ── the act ────────────────────────────────────────────────────────

test("archiving proposes a change and takes nothing off the record yet", async () => {
  // Like every other act on a binder: `main` is protected, and what is in
  // force does not change until somebody approves it.
  const { session, org, binder } = await provisionBinder();

  const proposed = await archive(session, org, binder, "nursing/hand-hygiene");
  const body = await proposed.text();
  expect(proposed.status, body).toBe(201);
  const { changeNumber } = JSON.parse(body) as { changeNumber: number };
  expect(changeNumber).toEqual(expect.any(Number));

  // Still there, still on its version.
  expect(await readArchive(session, org, binder)).toEqual([]);

  // **And the change says what it would take off.** The comparison screen
  // shows everything a change does, and a screen that listed only what the
  // change *versions* would show a reviewer nothing at all for an archiving —
  // the one act whose whole content is a removal. Gitea's own `deleted` file
  // status is what this reads, which is why it is asserted against a running
  // server rather than a mock.
  const detail = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${changeNumber}`,
    { headers: { Cookie: `bindersnap_session=${session}` } },
  );
  const change = (await detail.json()) as {
    documents: unknown[];
    removedDocuments: {
      slugPath: string;
      lastVersion: { version: number } | null;
    }[];
  };
  expect(change.documents).toEqual([]);
  expect(change.removedDocuments).toHaveLength(1);
  expect(change.removedDocuments[0]!.slugPath).toBe("nursing/hand-hygiene");
  expect(change.removedDocuments[0]!.lastVersion?.version).toBe(1);
});

test("a published archiving takes it off the record and into the archive", async () => {
  const { session, org, binder } = await provisionBinder();

  const proposed = await archive(session, org, binder, "nursing/hand-hygiene");
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  const published = await approveAndPublish(session, org, binder, changeNumber);

  // The audit tag, written in the same publish that merged the removal.
  expect((published.archived as Array<{ tag: string }>)[0]?.tag).toMatch(
    /^[0-9A-HJKMNP-TV-Z]{26}\/archived-1$/,
  );

  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as {
    documents: Array<{ slugPath: string }>;
    archivedCount: number;
  };
  expect(listed.documents.map((entry) => entry.slugPath)).not.toContain(
    "nursing/hand-hygiene",
  );
  expect(listed.archivedCount).toBe(1);

  const archived = await readArchive(session, org, binder);
  expect(archived).toHaveLength(1);
  // The name and the folder come out of the tags, because the tree no longer
  // holds this document and nothing else remembers what it was called.
  expect(archived[0]!.title).toBe("Hand Hygiene");
  expect(archived[0]!.slugPath).toBe("nursing/hand-hygiene");
  expect(archived[0]!.lastVersion).toBe(1);
  expect(archived[0]!.archivedAt).toBeTruthy();
  expect(archived[0]!.archivings).toBe(1);
});

test("the versions survive, which is the whole reason for the word", async () => {
  // Archiving removes a file from `main`. The tag still points at the commit
  // that held it, and git never collects a commit reachable from a ref — so
  // the bytes are still there, at every version the policy reached. If this
  // ever fails, "archive" has become a lie and the feature has to go.
  const { session, org, binder } = await provisionBinder();

  const before = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents/nursing/hand-hygiene`,
    { headers: authHeaders(session) },
  );
  const detail = (await before.json()) as {
    versions: Array<{ tag: string; version: number }>;
  };
  const tag = detail.versions[0]!.tag;

  const proposed = await archive(session, org, binder, "nursing/hand-hygiene");
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);

  // Read the file back at the version tag, after it has left `main`.
  const raw = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/nursing/hand-hygiene?ref=${encodeURIComponent(tag)}`,
    {
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
    },
  );
  expect(raw.status, await raw.clone().text()).toBe(200);
  expect(await raw.text()).toContain("The policy text.");
});

test("no second branch is made, because two merges can half-apply", async () => {
  // The design the customer raised and agreed against: archived files pushed
  // to a separate `archive` branch by a second hidden change. If the archive
  // merge failed after the `main` merge succeeded, the document would be gone
  // from `main` and absent from the archive — evidence loss, which is the
  // failure ADR 0004 exists to prevent. Asserted so nobody rebuilds it by
  // accident.
  const { session, org, binder } = await provisionBinder();

  const proposed = await archive(session, org, binder, "nursing/hand-hygiene");
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);

  const branches = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  expect(branches.status).toBe(200);

  // And no second change request was opened behind anybody's back.
  const changes = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes?state=open`,
    { headers: authHeaders(session) },
  );
  expect(((await changes.json()) as { changes: [] }).changes).toHaveLength(0);
});

test("a rename is not an archiving, however Gitea reports it", async () => {
  // Gitea reports a rename as `deleted` plus `added`. Reading the removed half
  // alone would write an `archived-1` tag for every policy anybody renamed,
  // and the archive would list documents that are sitting on `main`.
  const { session, org, binder } = await provisionBinder();

  const renamed = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-renames`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        documentPath: "nursing/hand-hygiene",
        name: "Hand Hygiene and PPE",
      }),
    },
  );
  const { changeNumber } = (await renamed.json()) as { changeNumber: number };
  const published = await approveAndPublish(session, org, binder, changeNumber);

  expect(published.archived).toEqual([]);
  expect(await readArchive(session, org, binder)).toEqual([]);
});

test("a file with no identity is refused, because that would be a deletion", async () => {
  // Not about the tag. A file this product did not write has no version tags,
  // so removing it from `main` leaves no ref pointing at the commit that held
  // it — the one case where "archive" would be a lie.
  const { session, org, binder } = await provisionBinder();

  const refused = await archive(session, org, binder, "nowhere/nothing");
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("is not in this binder");
});

// ── in the browser ─────────────────────────────────────────────────

test("Archive is an act of edit mode, and the draft is the undo", async ({
  page,
}) => {
  // No confirmation dialog, deliberately: the act goes into the draft like
  // every other one, the bar names it, and Discard undoes the lot. A modal
  // asking "are you sure" in front of something already reversible teaches
  // people to click through warnings.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  // Folders start shut, so the policy is reached the way a person reaches it.
  await openTreeFolder(page, "Nursing");
  await page.getByRole("button", { name: "Archive Hand Hygiene" }).click();

  await expect(page.locator(".bs-draftbar")).toContainText(
    "Archive Hand Hygiene",
    { timeout: 30_000 },
  );
  // Gone from the tree you are editing, and still on the record.
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toHaveCount(0);
  expect(await readArchive(session, org, binder)).toEqual([]);

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".bs-draftbar")).toBeHidden({ timeout: 30_000 });
  await openTreeFolder(page, "Nursing");
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toBeVisible();
});

test("a folder cannot be archived, because that is a different act", async ({
  page,
}) => {
  // Archiving a folder would mean archiving everything in it — much larger
  // than the button looks, and not something anybody asked for.
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  await expect(
    page.getByRole("button", { name: "Archive Nursing" }),
  ).toHaveCount(0);
  // The folder still has its other two.
  await expect(
    page.getByRole("button", { name: "Rename Nursing" }),
  ).toBeVisible();
});

test("the archive has a way in, and only once there is something in it", async ({
  page,
}) => {
  const { session, org, binder } = await provisionBinder();
  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);

  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });
  // A binder that has archived nothing carries no link to an empty page.
  await expect(page.locator(".binder-archive-link")).toHaveCount(0);

  const proposed = await archive(session, org, binder, "nursing/hand-hygiene");
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);

  await page.reload();
  await page.locator(".binder-archive-link").click();

  await expect(page).toHaveURL(/\?archive=1$/);
  await expect(page.getByText("Hand Hygiene")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Last published as version 1/)).toBeVisible();

  await page.getByRole("button", { name: /Back to the binder/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${org}/${binder}$`));
});

// ── bringing one back ──────────────────────────────────────────────

/** Archive a policy and publish it, so there is something to restore. */
async function archiveAndPublish(
  session: string,
  org: string,
  binder: string,
  documentPath: string,
): Promise<void> {
  const proposed = await archive(session, org, binder, documentPath);
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);
}

async function restore(
  session: string,
  org: string,
  binder: string,
  uid: string,
): Promise<Response> {
  return fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-restores`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ uid }),
    },
  );
}

test("the archive opens in the tree, and Restore goes into the draft", async ({
  page,
}) => {
  // **It was a page of its own, reachable only from the reading view** — so
  // edit mode, the one place somebody can act on what they find there, had no
  // way in and no way back. It is a section of the tree now, and restoring is
  // an ordinary act of the draft like every other.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await expect(page.locator(".binder-tree")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible({ timeout: 30_000 });

  // Editing offers the archive in place; the link to the page of its own is
  // for reading, so it is not drawn twice.
  await expect(page.locator(".binder-archive-link")).toHaveCount(0);
  const disclosure = page.getByRole("button", { name: /^Archived · / });
  await expect(disclosure).toBeVisible();
  await disclosure.click();

  // **"Restore as v2", not "Restore".** It comes back at the filename it left
  // with, so it keeps its identity and rejoins as its next version — which is
  // the question somebody hesitating here actually has.
  const restoreButton = page.getByRole("button", { name: "Restore as v2" });
  await expect(restoreButton).toBeVisible({ timeout: 30_000 });
  await restoreButton.click();

  // Into the draft, and on the tree, and still not on the record. At the
  // binder's top level — archiving the only policy in Nursing took the folder
  // with it, and the draft bar says so: "to the binder's top level".
  await expect(page.locator(".bs-draftbar")).toContainText("Restore", {
    timeout: 30_000,
  });
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toBeVisible({ timeout: 30_000 });
  expect((await readArchive(session, org, binder)).length).toBe(1);

  // And the draft is the undo, here as everywhere else.
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".bs-draftbar")).toBeHidden({ timeout: 30_000 });
  await expect(
    page.locator(".binder-tree-label", { hasText: "Hand Hygiene" }),
  ).toHaveCount(0);
});

test("a restored policy comes back on its next version, not at v1", async () => {
  // The reason ADR 0005 had to come first. The identity is a segment of the
  // filename, the restore writes that filename, so the version tags still
  // match and the policy carries on across the gap rather than restarting with
  // every tag it had orphaned behind it.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  const [entry] = await readArchive(session, org, binder);
  expect(entry!.lastVersion).toBe(1);

  const proposed = await restore(session, org, binder, entry!.uid);
  const body = await proposed.text();
  expect(proposed.status, body).toBe(201);
  await approveAndPublish(session, org, binder, JSON.parse(body).changeNumber);

  // Back in the binder, at v2, and out of the archive.
  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as {
    documents: Array<{
      slugPath: string;
      uid: string;
      latestVersion: { version: number } | null;
    }>;
    archivedCount: number;
  };
  // **Found by identity, not by address.** It is the same policy, and that is
  // the whole claim — but it does not necessarily come back to the same place:
  // `nursing` held only this one, so archiving it emptied the folder and the
  // folder went with it. Where it lands is the next test's business.
  const back = listed.documents.find((document) => document.uid === entry!.uid);
  expect(back).toBeTruthy();
  expect(back!.latestVersion?.version).toBe(2);
  expect(listed.archivedCount).toBe(0);
  expect(await readArchive(session, org, binder)).toEqual([]);
});

test("the comparison marks a restore, which would otherwise read as an edit", async ({
  page,
}) => {
  // A restore writes the file back under the identity it always had, so it
  // has a step and a diff like any revision. The tags are what know it was in
  // the archive, and the file's bar is where a reviewer has to be told.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  const [entry] = await readArchive(session, org, binder);
  const proposed = await restore(session, org, binder, entry!.uid);
  const body = await proposed.text();
  expect(proposed.status, body).toBe(201);
  const change = (JSON.parse(body) as { changeNumber: number }).changeNumber;

  const compare = `${APP_BASE_URL}/${org}/${binder}?tab=changes&change=${change}&view=compare`;
  await signInBrowser(page, session);
  await page.goto(compare);
  await expect(page.locator(".cmp-kind--restored")).toHaveText("Restoring", {
    timeout: 30_000,
  });

  // Once published it is history, and the badge says what it did.
  await approveAndPublish(session, org, binder, change);
  await page.goto(compare);
  await expect(page.locator(".cmp-kind--restored")).toHaveText("Restored", {
    timeout: 30_000,
  });
});

test("the bytes come back, because a tag still points at them", async () => {
  // There is no archive branch to read from. The file is recovered from the
  // commit its last version tag points at, which git has kept for exactly this
  // reason — and the content has to survive the round trip byte for byte.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  const [entry] = await readArchive(session, org, binder);
  const proposed = await restore(session, org, binder, entry!.uid);
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);

  // At the top level, because `nursing` held only this policy and went with it.
  const raw = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/hand-hygiene`,
    {
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
    },
  );
  expect(raw.status, await raw.clone().text()).toBe(200);
  expect(await raw.text()).toBe("# Hand Hygiene\n\nThe policy text.\n");
});

test("it lands at the top level when its folder has gone", async () => {
  // Silently making the folder again would be a second act nobody asked for,
  // and would resurrect a filing decision somebody deliberately undid.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  // `nursing` held only that policy, so archiving it emptied the folder — and
  // an empty folder with no `.gitkeep` stops existing.
  const [entry] = await readArchive(session, org, binder);
  const proposed = await restore(session, org, binder, entry!.uid);
  const body = await proposed.text();
  expect(proposed.status, body).toBe(201);
  await approveAndPublish(session, org, binder, JSON.parse(body).changeNumber);

  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as {
    documents: Array<{ slugPath: string }>;
  };
  expect(listed.documents.map((document) => document.slugPath)).toContain(
    "hand-hygiene",
  );
});

test("archived, restored and archived again is three separate facts", async () => {
  // A single `<uid>/archived` tag would make the second archiving either a
  // failure or a lie. Each is its own date and its own change.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  const [first] = await readArchive(session, org, binder);
  const proposed = await restore(session, org, binder, first!.uid);
  const { changeNumber } = (await proposed.json()) as { changeNumber: number };
  await approveAndPublish(session, org, binder, changeNumber);

  // It came back at the top level, because its folder went with it.
  await archiveAndPublish(session, org, binder, "hand-hygiene");

  const [again] = await readArchive(session, org, binder);
  expect(again!.uid).toBe(first!.uid);
  expect(again!.archivings).toBe(2);
  // The version it left on the second time, which is not the one it left on
  // the first.
  expect(again!.lastVersion).toBe(2);
});

test("restoring something the binder already holds is refused", async () => {
  const { session, org, binder } = await provisionBinder();

  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as {
    documents: Array<{ slugPath: string; uid: string }>;
  };
  const present = listed.documents.find(
    (document) => document.slugPath === "nursing/hand-hygiene",
  )!;

  const refused = await restore(session, org, binder, present.uid);
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("already in this binder");
});

test("Restore opens a change request rather than putting it straight back", async ({
  page,
}) => {
  // Everything else in this product proposes, and a policy reappearing on the
  // record without a decision would be the one act that skipped review.
  const { session, org, binder } = await provisionBinder();
  await archiveAndPublish(session, org, binder, "nursing/hand-hygiene");

  await signInBrowser(page, session);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?archive=1`);

  await expect(page.getByText("Hand Hygiene")).toBeVisible({ timeout: 30_000 });
  // The button says what it will do to the history, because that is the
  // question somebody hesitating over it actually has.
  const restoreButton = page.getByRole("button", {
    name: "Restore as version 2",
  });
  await expect(restoreButton).toBeVisible();
  await restoreButton.click();

  // Straight to the change request it opened.
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });

  // And nothing is back in the binder until that is published.
  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as {
    documents: Array<{ slugPath: string }>;
  };
  expect(listed.documents.map((document) => document.slugPath)).not.toContain(
    "nursing/hand-hygiene",
  );
});

/**
 * The count and the list are one question, asked of one branch.
 *
 * **The customer could see the two disagree:** *"I see that the archive has 1
 * more document in it by a count displayed, but when I try to expand the
 * archive it does not work."* The binder counts its archive from whatever tree
 * it is showing — the draft, while you are editing it — and the archive itself
 * was read from `main`. A policy archived in a draft is off the draft's tree
 * and still on `main`, and will be until the change publishes, so the heading
 * said one and the list said none.
 */
test("the archive is read from the draft the count was counted in", async () => {
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);

  const archived = await archive(session, org, binder, "nursing/hand-hygiene", {
    draft,
  });
  expect(archived.status, await archived.clone().text()).toBe(201);

  // Nothing has been published, so `main` is untouched and says so.
  expect(await readArchive(session, org, binder)).toEqual([]);

  const inDraft = await readArchive(session, org, binder, draft);
  expect(inDraft).toHaveLength(1);
  expect(inDraft[0]).toMatchObject({
    slugPath: "nursing/hand-hygiene",
    lastVersion: 1,
  });
});

/**
 * And it is named, not identified.
 *
 * A policy archived in a draft has no `archived-<n>` tag yet — that is written
 * when the change publishes — so the only stamp is its last version's, and a
 * binder tagged before stamps carried titles has nothing to read a name out
 * of. `main` still holds the file under the name it had an act ago, which is
 * better evidence than a 26-character identity.
 */
test("a policy archived in a draft is listed under its name", async () => {
  const { session, org, binder } = await provisionBinder();
  const draft = await openDraft(session, org, binder);
  await archive(session, org, binder, "nursing/hand-hygiene", { draft });

  const [entry] = await readArchive(session, org, binder, draft);
  expect(entry!.title).toBe("Hand Hygiene");
  expect(entry!.uid).not.toBe(entry!.title);
});

/** Somebody else's draft is not a ref you may read the binder at. */
test("the archive refuses a draft that is not yours", async () => {
  const { session, org, binder } = await provisionBinder();

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/archive?draft=draft/someone-else/20260101000000`,
    { headers: authHeaders(session) },
  );
  expect(response.status).toBe(409);
});
