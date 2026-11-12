/**
 * A folder on the editor's desk, and "Who signs off here" in the editor's
 * right-hand panel, edited into the draft.
 *
 * Against the seeded Governance binder as alice, who administers it. The
 * draft this makes is discarded at the end, so the seed is left as found.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const BINDER = `${APP_BASE_URL}/${OWNER}/governance`;
const DRAFT_API = `${API_BASE_URL}/api/app/binders/${OWNER}/governance/draft`;

/** Discard every draft alice has in Governance, so a rerun starts clean. */
async function discardAlicesDrafts(page: import("@playwright/test").Page) {
  const listed = await page.request.get(DRAFT_API, {
    headers: { Origin: APP_BASE_URL },
  });
  const body = (await listed.json()) as { drafts?: Array<{ branch: string }> };
  for (const draft of body.drafts ?? []) {
    await page.request.delete(
      `${DRAFT_API}?draft=${encodeURIComponent(draft.branch)}`,
      { headers: { Origin: APP_BASE_URL } },
    );
  }
}

test("Edit on a folder puts it on the desk, and its rules are edited beside it", async ({
  page,
}) => {
  await signInAsAlice(page);
  await discardAlicesDrafts(page);
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);
  await page
    .locator(".bs-pagehead-actions")
    .getByRole("button", { name: "Edit", exact: true })
    .click();

  // The folder, on the desk: its head card and its list, no picker.
  await expect(page).toHaveURL(
    /\/-\/tree\/main\/clinical-standards\?edit=write/,
    {
      timeout: 60_000,
    },
  );
  const desk = page.locator(".doc-folder-desk");
  await expect(desk.getByText("Clinical Standards").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    desk.getByRole("button", { name: "Upload files here" }),
  ).toBeVisible();
  await expect(
    desk.getByRole("button", { name: "New document here" }),
  ).toBeVisible();
  await expect(
    desk.locator(".binder-tree-label", { hasText: "Sepsis Pathway" }),
  ).toBeVisible();
  await expect(desk.getByRole("button", { name: /Published/ })).toHaveCount(0);
  await expect(page.locator(".bs-doc-status")).toContainText("Folder");

  // The rules, on the right, editable.
  const side = page.getByRole("complementary", { name: "Who signs off here" });
  await expect(side).toContainText("For Clinical Standards");
  await expect(side).toContainText("Infection Control");
  await expect(side).toContainText("Read only here");

  await side.getByPlaceholder("Add a group or a person").fill("Quality");
  await page
    .locator(".rev-picker-result", { hasText: "Quality Committee" })
    .click();
  await expect(
    side.locator(".signoff-row", { hasText: "Quality Committee" }),
  ).toBeVisible({ timeout: 30_000 });

  // It is in the draft, as one rule for the folder.
  const branch = new URL(page.url()).searchParams.get("draft")!;
  const read = await page.request.get(
    `${API_BASE_URL}/api/app/binders/${OWNER}/governance/rules/sign-off?draft=${encodeURIComponent(branch)}`,
    { headers: { Origin: APP_BASE_URL } },
  );
  const rules = (
    (await read.json()) as {
      rules: Array<{ scope: string; target: string; teams: string[] }>;
    }
  ).rules;
  expect(
    rules.find(
      (rule) => rule.scope === "folder" && rule.target === "clinical-standards",
    )?.teams,
  ).toEqual(["infection-control", "quality-committee"]);

  // An origin moves the desk: the binder, from Policy Office's row.
  await side.getByRole("link", { name: "Governance" }).first().click();
  await expect(side).toContainText("For Governance");
  await expect(side).toContainText("Any change to who signs off");

  // A document puts its own rules there; its folder's come from above.
  await page
    .locator(".doc-files")
    .getByRole("button", { name: "Open Clinical Standards here" })
    .click()
    .catch(() => undefined);
  await page.locator(".doc-files").getByText("Sepsis Pathway").click();
  await expect(side).toContainText("For Sepsis Pathway", { timeout: 30_000 });
  await expect(side).toContainText("Nothing is set on this document alone.");

  // Leave the seed as it was found.
  await discardAlicesDrafts(page);
});

test("New document and New folder in the editor's panel make them in the folder you are in", async ({
  page,
}) => {
  await signInAsAlice(page);
  await discardAlicesDrafts(page);
  await page.goto(`${BINDER}/-/tree/main/clinical-standards`);
  await page
    .locator(".bs-pagehead-actions")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page).toHaveURL(/\/clinical-standards\?edit=write/, {
    timeout: 60_000,
  });
  const files = page.getByRole("complementary", {
    name: "Files in Governance",
  });

  // New folder starts inside Clinical Standards, not at the binder's top.
  await files.getByRole("button", { name: "New folder", exact: true }).click();
  await expect(page.getByLabel("What to call it")).toHaveValue(
    /^clinical-standards\//,
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  // New document is made there too.
  await files
    .getByRole("button", { name: "New document", exact: true })
    .click();
  await expect(page).toHaveURL(/\/clinical-standards\/untitled\?edit=write/, {
    timeout: 60_000,
  });

  await discardAlicesDrafts(page);
});
