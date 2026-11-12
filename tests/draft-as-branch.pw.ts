/**
 * A draft is a branch, and is read like one: the binder's own page, its
 * folders and its documents, with the rules that are in it — and moving
 * around in it stays in it.
 *
 * Against the seeded Governance binder as alice. The draft this makes is
 * discarded at the end, so the seed is left as found.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const BINDER = `${APP_BASE_URL}/${OWNER}/governance`;
const API = `${API_BASE_URL}/api/app/binders/${OWNER}/governance`;
const HEADERS = { Origin: APP_BASE_URL };
const NAME = "Quality reads Clinical Standards";

async function discardAlicesDrafts(page: Page) {
  const listed = await page.request.get(`${API}/draft`, { headers: HEADERS });
  const body = (await listed.json()) as { drafts?: Array<{ branch: string }> };
  for (const draft of body.drafts ?? []) {
    await page.request.delete(
      `${API}/draft?draft=${encodeURIComponent(draft.branch)}`,
      { headers: HEADERS },
    );
  }
}

/** A draft whose one act puts the Quality Committee on Clinical Standards. */
async function draftWithARule(page: Page): Promise<string> {
  const opened = await page.request.post(`${API}/draft`, {
    headers: HEADERS,
    data: { name: NAME },
  });
  expect(opened.ok()).toBeTruthy();
  const branch = ((await opened.json()) as { draft: { branch: string } }).draft
    .branch;
  const set = await page.request.put(`${API}/rules/sign-off`, {
    headers: HEADERS,
    data: {
      draft: branch,
      rule: {
        scope: "folder",
        target: "clinical-standards",
        teams: ["infection-control", "quality-committee"],
        users: [],
      },
    },
  });
  expect(set.ok(), await set.text()).toBeTruthy();
  return branch;
}

test("a draft is read like the record: its page, folders, documents and rules", async ({
  page,
}) => {
  await signInAsAlice(page);
  await discardAlicesDrafts(page);
  const branch = await draftWithARule(page);
  const onDraft = encodeURIComponent(branch);

  // On the record, Clinical Standards has no Quality Committee.
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);
  const rail = page.locator(".doc-rail .signoff");
  await expect(rail).toContainText("Infection Control", { timeout: 60_000 });
  await expect(rail).not.toContainText("Quality Committee");

  // The binder's picker opens the draft as a branch: the same page.
  await page.goto(BINDER);
  await page.getByRole("button", { name: /^Version:/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(NAME) }).click();
  await expect(page).toHaveURL(new RegExp(`/-/tree/${onDraft}$`), {
    timeout: 30_000,
  });
  await expect(page.locator(".doc-rail .signoff")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Version:/ })).toContainText(
    NAME,
  );

  // Its folder, from its tree, is the draft's folder, with the draft's rule.
  await page
    .locator(".binder-tree")
    .getByRole("link", { name: /^Clinical Standards/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/-/tree/${onDraft}/clinical-standards`),
  );
  await expect(
    rail.locator(".signoff-row", { hasText: "Quality Committee" }),
  ).toBeVisible({ timeout: 30_000 });

  // A document in it is read in the draft, and its rules are the draft's.
  await page
    .locator(".binder-tree")
    .getByRole("link", { name: /^Sepsis Pathway/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/-/blob/${onDraft}/`), {
    timeout: 30_000,
  });
  await expect(rail).toContainText("Quality Committee", { timeout: 30_000 });

  // The explorer says which version, with the draft's icon, and its folder
  // link stays in the draft.
  const explorer = page.locator(".app-explorer");
  await expect(explorer.locator(".app-explorer-versionbtn")).toContainText(
    NAME,
  );
  await expect(
    explorer.locator(
      ".app-explorer-versionbtn .app-explorer-versionicon--record",
    ),
  ).toHaveCount(0);
  await explorer
    .getByRole("link", { name: "Clinical Standards", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/-/tree/${onDraft}/clinical-standards`),
  );

  // Edit here carries on in this draft, not the newest or a new one.
  await page
    .locator(".bs-pagehead-actions")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`clinical-standards\\?edit=write&draft=${onDraft}`),
    { timeout: 60_000 },
  );

  // And the record still has no Quality Committee there.
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);
  await expect(rail).toContainText("Infection Control", { timeout: 60_000 });
  await expect(rail).not.toContainText("Quality Committee");

  await discardAlicesDrafts(page);
});

test("a document read in your draft keeps you in it as you move around", async ({
  page,
}) => {
  await signInAsAlice(page);
  await discardAlicesDrafts(page);
  const branch = await draftWithARule(page);
  const onDraft = encodeURIComponent(branch);

  // Where Close in the editor lands: the document, in the draft.
  await page.goto(
    `${BINDER}/-/blob/main/clinical-standards/sepsis-pathway?edit=1&draft=${onDraft}`,
  );
  const rail = page.locator(".doc-rail .signoff");
  await expect(rail).toContainText("Quality Committee", { timeout: 60_000 });

  // Its folder, from the explorer and from the path over the page.
  const explorer = page.locator(".app-explorer");
  await explorer
    .getByRole("link", { name: "Clinical Standards", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/-/tree/${onDraft}/clinical-standards`),
    { timeout: 30_000 },
  );
  await expect(rail).toContainText("Quality Committee", { timeout: 30_000 });

  await discardAlicesDrafts(page);
});
