/**
 * The document editor: a policy written in Bindersnap opens in a word
 * processor, and Save puts it in your draft.
 *
 * **What this is proving.** That the editor's Save is the same act as every
 * other edit to a binder — a commit to the author's draft, and nothing on the
 * record moves until the draft is proposed and published. The formatting and
 * find-and-replace are unit-tested in `packages/editor`; what a mock cannot
 * say is whether the words typed here are the words in the file on the
 * branch, and whether the version on record is untouched.
 *
 * Each test signs up its own person, organization and binder, so it owns the
 * draft it writes into.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 240_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `write-${suffix}`,
    email: `write-${suffix}@users.bindersnap.local`,
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
  expect(response.status, await response.clone().text()).toBe(200);
  return sessionFrom(response);
}

/** A policy the editor wrote: its JSON, as the seed and the editor store it. */
const POLICY = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Hand Hygiene" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Clean your hands before and after contact." },
      ],
    },
  ],
};

/**
 * A binder holding one policy written in the editor, published — so there is
 * a version on record for the draft to differ from.
 */
async function provision(): Promise<{
  session: string;
  org: string;
  binder: string;
}> {
  const session = await signUp(buildCredentials());

  const orgResponse = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: `Writers ${randomUUID().slice(0, 6)}` }),
  });
  const orgBody = await orgResponse.text();
  expect(orgResponse.status, orgBody).toBe(201);
  const org = (JSON.parse(orgBody) as { organization: { name: string } })
    .organization.name;

  const binderResponse = await fetch(
    `${API_BASE_URL}/api/app/orgs/${org}/binders`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ name: "Clinical Policies" }),
    },
  );
  const binderBody = await binderResponse.text();
  expect(binderResponse.status, binderBody).toBe(201);
  const binder = (JSON.parse(binderBody) as { workspace: { name: string } })
    .workspace.name;

  const form = new FormData();
  form.set(
    "file",
    new Blob([JSON.stringify(POLICY, null, 2)], { type: "application/json" }),
    "document.json",
  );
  form.set("name", "Hand Hygiene");
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
  const change = (JSON.parse(addedBody) as { pullRequestNumber: number })
    .pullRequestNumber;

  // A second person approves, and the author publishes. Retried because
  // Gitea can dismiss an approval recorded against a head it is still
  // processing — see `binder-edit-mode.pw.ts`.
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
    if (published.status === 200) break;
  }
  expect(published?.status, await published?.text()).toBe(200);

  return { session, org, binder };
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

/** The policy's text on a ref, read the way a download reads it. */
async function policyText(
  session: string,
  org: string,
  binder: string,
  ref?: string,
): Promise<string> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/hand-hygiene${query}`,
    { headers: authHeaders(session) },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return response.text();
}

test("a policy written here opens in the editor, and Save puts it in your draft", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  // The document's own address, in edit mode, naming the draft.
  await expect(page).toHaveURL(/\/hand-hygiene\?edit=write&draft=draft%2F/);
  const draft = new URL(page.url()).searchParams.get("draft")!;

  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toContainText("Clean your hands");
  await expect(page.getByText("No changes yet")).toBeVisible();
  // The draft's files are beside the page, and this one is marked.
  await expect(
    page
      .getByRole("complementary", { name: `Files in Clinical Policies` })
      .getByRole("button", { name: "Hand Hygiene" }),
  ).toHaveAttribute("aria-current", "page");

  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Alcohol rub is enough unless hands are soiled.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });

  // The words are in the draft, and the record has not moved.
  expect(await policyText(session, org, binder, draft)).toContain(
    "Alcohol rub is enough",
  );
  expect(await policyText(session, org, binder)).not.toContain("Alcohol rub");

  // Close is the way back to the document, still in the draft.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/hand-hygiene\?edit=1&draft=/);
  await expect(page.locator(".doc-preview-prose")).toContainText(
    "Alcohol rub is enough",
  );
});

test("closing with unsaved words asks first, and Cancel keeps them", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Every time.");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Save your changes to Hand Hygiene?");
  await ask.getByRole("button", { name: "Cancel" }).click();

  await expect(ask).toHaveCount(0);
  await expect(text).toContainText("Every time.");
  await expect(page).toHaveURL(/edit=write/);
});

test("a new policy can be written here instead of uploaded", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await page.getByRole("button", { name: "Add a document" }).click();
  await page.getByRole("radio", { name: /Write it here/ }).check();
  await page.getByLabel("What it is called").fill("Visitor Policy");
  await page.getByRole("button", { name: "Start writing" }).click();

  // Straight into the editor, in the draft it was started in, with the title
  // written and the cursor on the line under it.
  await expect(page).toHaveURL(/\/visitor-policy\?edit=write&draft=draft%2F/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const text = page.getByRole("textbox", { name: "Visitor Policy" });
  await expect(text.locator("h1")).toHaveText("Visitor Policy");
  await expect(text).toBeFocused();

  await page.keyboard.type("Visitors sign in at reception.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });

  const saved = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/visitor-policy?ref=${encodeURIComponent(draft)}`,
    { headers: authHeaders(session) },
  );
  expect(saved.status).toBe(200);
  expect(await saved.text()).toContain("Visitors sign in at reception.");
});

test("the editor's file panel starts a policy and moves between them, saving first", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const files = page.getByRole("complementary", {
    name: "Files in Clinical Policies",
  });

  // New, from inside the editor: the dialog opens on Write.
  await files.getByRole("button", { name: "New document" }).click();
  await expect(
    page.getByRole("radio", { name: /Write it here/ }),
  ).toBeChecked();
  await page.getByLabel("What it is called").fill("Visitor Policy");
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page).toHaveURL(/\/visitor-policy\?edit=write&draft=draft%2F/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const visitor = page.getByRole("textbox", { name: "Visitor Policy" });
  await expect(visitor).toBeFocused();
  await expect(
    files.getByRole("button", { name: "Visitor Policy" }),
  ).toBeVisible();

  // Back to the first policy with unsaved words: asked, and saved on the way.
  await page.keyboard.type("Visitors sign in at reception.");
  await files.getByRole("button", { name: "Hand Hygiene" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Save your changes to Visitor Policy?");
  await ask.getByRole("button", { name: "Save and open" }).click();

  await expect(page).toHaveURL(/\/hand-hygiene\?edit=write&draft=/);
  await expect(
    page.getByRole("textbox", { name: "Hand Hygiene" }),
  ).toContainText("Clean your hands");
  const saved = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/visitor-policy?ref=${encodeURIComponent(draft)}`,
    { headers: authHeaders(session) },
  );
  expect(saved.status).toBe(200);
  expect(await saved.text()).toContain("Visitors sign in at reception.");
});

test("a picture from this device is kept inside the policy, in the draft", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");

  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Picture" }).click();
  // A 1×1 PNG: small enough to be kept byte for byte.
  await page.locator(".bs-rform input[type=file]").setInputFiles({
    name: "Hand_Wash-Poster.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });

  // In the page, described from its file name, with the cursor back in the
  // text so the next keystroke — here, Save — lands where it should.
  await expect(
    text.getByRole("img", { name: "Hand Wash Poster" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });

  const saved = await policyText(session, org, binder, draft);
  expect(saved).toContain('"type": "image"');
  expect(saved).toContain("data:image/png;base64,");
  // And the reader shows it.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.locator(".doc-preview-prose").getByRole("img", {
      name: "Hand Wash Poster",
    }),
  ).toBeVisible();
});

test("words never saved are kept on this device and offered back", async ({
  context,
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const address = page.url();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Nails kept short.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // Kept a moment after the last keystroke.
  await page.waitForTimeout(1500);

  // The tab goes away with the words unsaved — a crash, as far as the page
  // can tell.
  await page.close();
  const again = await context.newPage();
  await again.goto(address);

  const offer = again.getByRole("status").filter({
    hasText: "were kept on this device",
  });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  const reopened = again.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(reopened).not.toContainText("Nails kept short.");
  await offer.getByRole("button", { name: "Restore" }).click();
  await expect(reopened).toContainText("Nails kept short.");
  await expect(again.getByText("Unsaved changes")).toBeVisible();

  // Saved, the copy is gone: the next visit offers nothing.
  await again.keyboard.press("ControlOrMeta+s");
  await expect(again.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });
  await again.reload();
  // The editor is loaded on demand, which on a slow runner is past the
  // default five seconds after a reload.
  await expect(
    again.getByRole("textbox", { name: "Hand Hygiene" }),
  ).toContainText("Nails kept short.", { timeout: 20_000 });
  await expect(again.getByText("were kept on this device")).toHaveCount(0);
});
