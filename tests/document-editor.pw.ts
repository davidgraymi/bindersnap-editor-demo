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

// A desktop window, wide enough that the ribbon shows its Styles gallery:
// several tests read the gallery's "Normal" to know the click has landed, and
// how much of the gallery fits at 1280 depends on the machine's fonts. The
// tablet test sets its own size, and is where the folding is tested.
test.use({ viewport: { width: 1440, height: 900 } });

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

test("after a save, every page reads the draft as it now is, not a copy kept from before", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  // Every read of a file on a branch, and what it told the browser to keep.
  const kept: string[] = [];
  page.on("response", (response) => {
    if (/\/raw\//.test(response.url())) {
      kept.push(response.headers()["cache-control"] ?? "");
    }
  });

  // Read the policy on the draft first, as the draft picker does, so the
  // browser holds a copy of it from before the save.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const onDraft = `${APP_BASE_URL}/${org}/${binder}/hand-hygiene?ref=${encodeURIComponent(draft)}`;
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toContainText("before and after contact");
  await page.goto(onDraft);
  await expect(page.locator(".doc-preview-prose")).toContainText(
    "before and after contact",
  );

  // Take a word out, and save.
  await page.goBack();
  await expect(text).toContainText("before and after contact");
  const word = await wordBox(page, "and after");
  await page.mouse.dblclick(word.x - 20, word.y);
  await expect(page.getByRole("button", { name: "Cut" })).toBeEnabled();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(text).toContainText("before after contact");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });

  // The draft, from the picker: the words as saved.
  await page.goto(onDraft);
  await expect(page.locator(".doc-preview-prose")).toContainText(
    "before after contact",
  );

  // And the change it becomes shows the word gone.
  await page.goto(
    `${APP_BASE_URL}/${org}/${binder}?edit=propose&draft=${encodeURIComponent(draft)}`,
  );
  await page
    .getByRole("textbox", { name: "What you are asking for" })
    .fill("Shorter wording");
  await page.getByRole("button", { name: "Open the change request" }).click();
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });
  await page.goto(`${page.url()}&view=compare`);
  await expect(page.locator("del", { hasText: "and" }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Nothing read on a branch was ever kept.
  expect(kept.length).toBeGreaterThan(0);
  for (const header of kept) expect(header).toBe("no-store");
});

test("the draft is chosen, proposed and read from the editor, with no trip through the binder", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const first = new URL(page.url()).searchParams.get("draft")!;
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toContainText("Clean your hands");

  // Which draft Save goes into is a control in the title bar.
  const picker = page.locator(".doc-editor-where .bs-draftpick");
  await expect(picker).toContainText("Draft of");
  const firstName = (await picker.innerText()).split("·")[0]!.trim();

  // Nothing to propose until there is something in the draft.
  const propose = page.getByRole("button", { name: "Propose", exact: true });
  await expect(propose).toBeDisabled();

  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" Every time.");

  // Propose from here: unsaved words are saved first, into this draft.
  await expect(propose).toBeEnabled();
  await propose.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Save and propose" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`edit=propose&draft=${encodeURIComponent(first)}`),
  );
  expect(await policyText(session, org, binder, first)).toContain(
    "Every time.",
  );

  // Back to editing lands back in the policy, not on the binder.
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(page).toHaveURL(/\/hand-hygiene\?edit=write/);
  await expect(text).toContainText("Every time.");

  // Another draft, started here: the same policy, as the record has it.
  await picker.click();
  await page.getByRole("button", { name: "Start another draft" }).click();
  const naming = page.getByRole("textbox", {
    name: "What to call the new draft",
  });
  await naming.fill("Gloves wording");
  await naming.press("Enter");
  await expect(picker).toContainText("Gloves wording");
  await expect(page).toHaveURL(/\/hand-hygiene\?edit=write/);
  expect(new URL(page.url()).searchParams.get("draft")).not.toBe(first);
  await expect(text).toContainText("Clean your hands");
  await expect(text).not.toContainText("Every time.");

  // And back to the first, where the words are.
  await picker.click();
  await page.getByRole("button", { name: new RegExp(`^${firstName}`) }).click();
  await expect(text).toContainText("Every time.");

  // Close reads the policy in that draft, and says so.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/hand-hygiene\\?edit=1&draft=${encodeURIComponent(first)}`),
  );
  await expect(page.locator(".doc-version-pill")).toHaveText(`In ${firstName}`);
  await expect(page.locator(".doc-preview-prose")).toContainText("Every time.");

  // The binder's own page, read on the record, is the way into either draft.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  const binderPicker = page.locator(".bs-draftpick");
  await expect(binderPicker).toContainText("On the record");
  await binderPicker.click();
  await expect(
    page.getByRole("button", { name: /^Gloves wording/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${firstName}`) }).click();
  await expect(page).toHaveURL(
    new RegExp(`edit=1&draft=${encodeURIComponent(first)}`),
  );
  await expect(page.locator(".bs-draftpick")).toContainText(firstName);
});

test("Edit on a binder opens the editor; Organize is the tree", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  // Straight into the words, with the draft's files beside them.
  await expect(page).toHaveURL(/\/hand-hygiene\?edit=write&draft=/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  await expect(
    page.getByRole("textbox", { name: "Hand Hygiene" }),
  ).toContainText("Clean your hands");

  // A save is an edit, and the draft says so in words.
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" Always.");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });

  // Renaming and refiling are the tree's, one press away, in the same draft.
  await page
    .getByRole("button", { name: "Organize: rename, move and make folders" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/${binder}\\?edit=1&draft=${encodeURIComponent(draft)}`),
  );
  await expect(page.locator(".bs-draftbar")).toContainText("Edit Hand Hygiene");
  await expect(page.locator(".bs-draftbar")).not.toContainText("document.json");

  // And from the binder's own page, Organize goes there directly.
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Organize", exact: true }).click();
  await expect(page.locator(".bs-draftbar")).toBeVisible();
  await expect(page).toHaveURL(/edit=1/);
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

  // The Home tab folds to fit beside the file panel rather than hiding
  // Find off the end of a sideways scroll.
  await page.setViewportSize({ width: 1280, height: 720 });
  const panel = page.locator(".bs-ribbon-panel");
  await expect
    .poll(() => panel.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(1);
  await expect(
    panel.getByRole("button", { name: /^Find/ }).first(),
  ).toBeInViewport();

  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Every time.");
  // Unsaved, and said so where somebody with several tabs open will look:
  // the browser tab, and the policy's row in the file panel.
  await expect(page).toHaveTitle(/^• Hand Hygiene/);
  await expect(
    page.getByRole("img", { name: "Unsaved changes" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Save your changes to Hand Hygiene?");
  await ask.getByRole("button", { name: "Cancel" }).click();

  await expect(ask).toHaveCount(0);
  await expect(text).toContainText("Every time.");
  await expect(page).toHaveURL(/edit=write/);
});

test("on a tablet the ribbon folds its groups and the files open over the page", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);
  await page.setViewportSize({ width: 700, height: 1000 });

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toBeVisible();

  // The files start as a rail, so the page has the width.
  const files = page.getByRole("complementary", {
    name: "Files in Clinical Policies",
  });
  await expect(files).toHaveCount(0);
  const show = page.getByRole("button", { name: "Show the draft's files" });
  await show.click();
  await expect(files).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(files).toHaveCount(0);

  // Every command fits, folded into its group's button, with no sideways
  // scroll; the Font group's commands are one press away.
  const panel = page.locator(".bs-ribbon-panel");
  await expect
    .poll(() => panel.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(1);
  const foldedFont = page
    .getByRole("group", { name: "Font" })
    .getByRole("button", { name: "Font", exact: true });
  await expect(foldedFont).toHaveAttribute("aria-haspopup", "dialog");
  await text
    .getByText("Clean your hands")
    .dblclick({ position: { x: 8, y: 5 } });
  // Cut lights up once the editor has the selected word.
  await expect(page.getByRole("button", { name: "Cut" })).toBeEnabled();
  await foldedFont.click();
  const font = page.getByRole("dialog", { name: "Font" });
  await font.getByRole("button", { name: "Bold" }).click();
  await expect(text.locator("strong")).toHaveCount(1);

  // A menu inside the fold opens and closes without taking the fold with it.
  await font.getByRole("button", { name: "Font color" }).click();
  await expect(page.getByRole("menu", { name: "Font color" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Font color" })).toHaveCount(0);
  await expect(font).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(font).toHaveCount(0);
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

test("a picture is sized by its corners or the Picture tab, and keeps its size", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  // At 100%, so a pixel dragged on screen is a pixel on the page.
  await page.getByRole("tab", { name: "View" }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: "100%", exact: true })
    .click();
  await text.getByText("Clean your hands").click();
  await page.keyboard.press("End");

  // A 400×200 picture, drawn here so the test carries no binary file.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2f6f5e";
    context.fillRect(0, 0, 400, 200);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Picture" }).click();
  await page.locator(".bs-rform input[type=file]").setInputFiles({
    name: "Sink.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const picture = text.getByRole("img", { name: "Sink" });
  await expect(picture).toBeVisible();
  // No Picture tab until the picture is chosen, as in Word.
  await expect(page.getByRole("tab", { name: "Picture" })).toHaveCount(0);

  await picture.click();
  await page.getByRole("tab", { name: "Picture" }).click();
  await page.getByRole("button", { name: "Medium" }).click();
  await expect(picture).toHaveAttribute("width", "312");
  await expect(page.getByRole("button", { name: "Medium" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Arrange: centred in its line, and still chosen, so the tab stays.
  const arrange = page.getByRole("tabpanel");
  await arrange.getByRole("button", { name: "Center" }).click();
  await expect(text.locator("p:has(img[alt='Sink'])")).toHaveCSS(
    "text-align",
    "center",
  );
  await expect(page.getByRole("tab", { name: "Picture" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await arrange.getByRole("button", { name: "Align left" }).click();
  await expect(text.locator("p:has(img[alt='Sink'])")).toHaveCSS(
    "text-align",
    "left",
  );

  // Drag the bottom-right corner 112 pixels left: 312 → 200 wide.
  const corner = page.locator(".bs-picture-handle--bottom-right");
  const box = (await corner.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + 10, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 - 112, box.y + 20, {
    steps: 4,
  });
  await page.mouse.up();
  await expect(picture).toHaveAttribute("width", "200");
  // Stored, not only drawn: the ribbon no longer calls it Medium.
  await expect(
    page.getByRole("button", { name: "Medium" }),
  ).not.toHaveAttribute("aria-pressed", "true");
  // It keeps its shape: the height follows the width.
  await expect
    .poll(async () => (await picture.boundingBox())?.height)
    .toBeCloseTo(100, 0);

  await page.getByRole("button", { name: "Alt text" }).click();
  const altText = page.getByRole("dialog", { name: "Alt text" });
  await altText
    .getByRole("textbox", { name: "Description, for screen readers" })
    .fill("The sink by the ward door");
  await altText.getByRole("button", { name: "Save" }).click();
  const described = text.getByRole("img", {
    name: "The sink by the ward door",
  });
  await expect(described).toBeVisible();

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });
  const saved = await policyText(session, org, binder, draft);
  expect(saved).toContain('"width": 200');

  // The reader draws it at the same size.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.locator(".doc-preview-prose").getByRole("img", {
      name: "The sink by the ward door",
    }),
  ).toHaveAttribute("width", "200");
});

test("a table of contents lists the headings and keeps up with them", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/edit=write/);
  const draft = new URL(page.url()).searchParams.get("draft")!;
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });

  // A section to list: a Heading 2 after the opening paragraph. The ribbon
  // saying Normal is the editor having taken the click, not the title.
  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+Alt+2");
  await page.keyboard.type("Gloves");

  // The contents go at the top, under the title, as Word's usually do.
  await text.getByText("Clean your hands").click({ position: { x: 1, y: 5 } });
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Table of contents" }).click();
  const contents = text.locator(".bs-toc");
  await expect(contents.locator(".bs-toc-entry")).toHaveText([
    "Hand Hygiene",
    "Gloves",
  ]);

  // Renaming a section renames its entry, with nothing to update by hand.
  await text.getByRole("heading", { name: "Gloves" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and aprons");
  await expect(contents.locator(".bs-toc-entry").nth(1)).toHaveText(
    "Gloves and aprons",
  );

  // An entry goes to its section.
  await contents.getByText("Gloves and aprons").click();
  await page.keyboard.type("Wearing ");
  await expect(
    text.getByRole("heading", { name: "Wearing Gloves and aprons" }),
  ).toBeVisible();
  await expect(contents.locator(".bs-toc-entry").nth(1)).toHaveText(
    "Wearing Gloves and aprons",
  );

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText(/Saved just now/)).toBeVisible({
    timeout: 20_000,
  });
  const saved = await policyText(session, org, binder, draft);
  expect(saved).toContain('"type": "tableOfContents"');

  // The reader shows the list the author saw.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const read = page.locator(".doc-preview-prose .bs-toc");
  await expect(read.getByText("Contents")).toBeVisible();
  await expect(read.getByText("Wearing Gloves and aprons")).toBeVisible();
});

/** Where a word is drawn on screen, to click it as a person would. */
async function wordBox(page: Page, word: string) {
  return page.evaluate((target) => {
    const content = document.querySelector(".bs-doc-content")!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(target);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + target.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    throw new Error(`"${target}" is not on the page`);
  }, word);
}

test("the Format Painter brushes one word's look onto others", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toBeVisible();

  // "Clean" in bold and underlined: the look to copy.
  const clean = await wordBox(page, "Clean");
  await page.mouse.dblclick(clean.x, clean.y);
  const cut = page.getByRole("button", { name: "Cut" });
  await expect(cut).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ControlOrMeta+u");
  await expect(text.locator("u strong, strong u")).toHaveText("Clean");

  // Pick it up, then click a word: that word takes it, and the brush is put
  // down, as Word's is after one stroke. (The cursor is still in "Clean".)
  const painter = page.getByRole("button", { name: "Format Painter" });
  await painter.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await expect(text).toHaveClass(/is-painting/);
  const hands = await wordBox(page, "hands");
  await page.mouse.click(hands.x, hands.y);
  await expect(text.locator("u strong, strong u")).toHaveText([
    "Clean",
    "hands",
  ]);
  await expect(painter).not.toHaveAttribute("aria-pressed", "true");

  // Double-click keeps it on for more than one stroke, until Escape. The
  // cursor is in "hands" now, which has the same look.
  await painter.dblclick();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  for (const word of ["before", "contact"]) {
    const box = await wordBox(page, word);
    await page.mouse.click(box.x, box.y);
  }
  await expect(text.locator("u strong, strong u")).toHaveText([
    "Clean",
    "hands",
    "before",
    "contact",
  ]);
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(painter).not.toHaveAttribute("aria-pressed", "true");
  await expect(text).not.toHaveClass(/is-painting/);
});

test("Change Case recases a word from the ribbon, and Shift+F3 cycles it", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toBeVisible();

  const clean = await wordBox(page, "Clean");
  await page.mouse.dblclick(clean.x, clean.y);
  await expect(page.getByRole("button", { name: "Cut" })).toBeEnabled();

  await page.getByRole("button", { name: "Change case" }).click();
  await page.getByRole("menuitem", { name: "UPPERCASE" }).click();
  await expect(text).toContainText("CLEAN your hands");

  // Back in the page, the words still selected: Shift+F3 goes on to
  // Capitalize Each Word, then lowercase, as Word's does.
  await text.focus();
  await page.keyboard.press("Shift+F3");
  await expect(text).toContainText("Clean your hands");
  await page.keyboard.press("Shift+F3");
  await expect(text).toContainText("clean your hands");
});

test("Paste keeps what was copied, and Keep Text Only keeps just the words", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: APP_BASE_URL,
  });
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  // Two paragraphs, one word of them bold — as a page or an email copies.
  await page.evaluate(async () => {
    const html = "<p><strong>Gloves</strong> first</p><p>Then wash</p>";
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob(["Gloves first\nThen wash"], {
          type: "text/plain",
        }),
      }),
    ]);
  });

  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(text.locator("strong")).toHaveText("Gloves");
  await expect(text.locator("p", { hasText: "Then wash" })).toHaveText(
    "Then wash",
  );

  await page.keyboard.press("ControlOrMeta+z");
  await expect(text).not.toContainText("Gloves");

  // The words alone: no bold, and still two paragraphs, not one run-on.
  await page.getByRole("button", { name: "Paste options" }).click();
  await page.getByRole("menuitem", { name: "Keep Text Only" }).click();
  await expect(text).toContainText("Gloves first");
  await expect(text.locator("strong")).toHaveCount(0);
  await expect(text.locator("p", { hasText: "Then wash" })).toHaveText(
    "Then wash",
  );
});

test("Insert > Date & Time writes today's date where the cursor is", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" Effective ");

  const iso = await page.evaluate(() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  });
  await page.getByRole("tab", { name: "Insert" }).click();
  await page.getByRole("button", { name: "Date & Time" }).click();
  await page.getByRole("menuitem", { name: iso }).click();
  await expect(text).toContainText(`Effective ${iso}`);
});

test("the status bar counts the selected words out of the whole", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const count = page.getByRole("button", { name: "Word count" });
  await expect(count).toHaveText("9 words");

  const clean = await wordBox(page, "Clean");
  await page.mouse.dblclick(clean.x, clean.y);
  await expect(count).toHaveText("1 of 9 words");

  await page.keyboard.press("ArrowRight");
  await expect(count).toHaveText("9 words");
});

test("typing curls quotes and makes dashes, and Backspace takes one back", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await text.getByText("Clean your hands").click();
  await expect(page.getByRole("option", { name: "Normal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await page.keyboard.type(` "Always"--it's policy (c)`);
  await expect(text).toContainText(
    "\u201CAlways\u201D\u2014it\u2019s policy \u00A9",
  );

  // Word's own undo for an AutoCorrect: straight back to what was typed.
  await page.keyboard.press("Backspace");
  await expect(text).toContainText("it\u2019s policy (c)");
});

test("a change that only makes a word bold still shows in its comparison", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Hand Hygiene" });
  await expect(text).toBeVisible();

  const clean = await wordBox(page, "Clean");
  await page.mouse.dblclick(clean.x, clean.y);
  await expect(page.getByRole("button", { name: "Cut" })).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(text.locator("strong")).toHaveText("Clean");

  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Save and propose" })
    .click();
  await page
    .getByRole("textbox", { name: "What you are asking for" })
    .fill("Make the first word stand out");
  await page.getByRole("button", { name: "Open the change request" }).click();
  await expect(page).toHaveURL(/tab=changes&change=\d+/, { timeout: 30_000 });

  // Not a word moved, and the comparison still says what did — rather than
  // drawing nothing under a document the list calls edited.
  await page.goto(`${page.url()}&view=compare`);
  await expect(page.locator(".cmp-counts-note")).toHaveText("Formatting", {
    timeout: 30_000,
  });
  await expect(page.locator(".doc-compare-restyled")).toContainText(
    "the formatting did",
  );
  await expect(page.locator(".doc-compare-prose strong")).toHaveText("Clean");
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

test("printing prints the policy, not the app around it", async ({ page }) => {
  const { session, org, binder } = await provision();
  await signInBrowser(page, session);

  await page.goto(`${APP_BASE_URL}/${org}/${binder}/hand-hygiene`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Hand Hygiene" }),
  ).toContainText("Clean your hands");

  // What Ctrl+P and the View tab's Print both set off.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  const copy = page.locator("body > .bs-print-root");
  await expect(copy).toBeVisible();
  await expect(copy).toContainText("Clean your hands");
  await expect(page.locator(".bs-ribbon")).toBeHidden();
  await expect(page.locator(".doc-files")).toBeHidden();
  // The policy's name is the running header.
  expect(
    await page
      .locator("#bs-print-margins")
      .evaluate((node) => node.textContent),
  ).toContain('content: "Hand Hygiene"');

  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".bs-print-root")).toHaveCount(0);
  await expect(page.locator(".bs-ribbon")).toBeVisible();
});
