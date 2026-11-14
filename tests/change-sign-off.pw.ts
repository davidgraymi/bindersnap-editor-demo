/**
 * A change that edits who signs off, on its overview, its Changes tab and at
 * the moment of approval (4.9–4.11).
 *
 * Against the seeded mixed change in Governance — a Hand Hygiene revision
 * and the Quality Committee added to Clinical Standards, in one draft. Read
 * only: the approval is opened and cancelled, never given.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, OWNER, signInAsAlice } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const TITLE = "Hand hygiene — gel at every bedside, and Quality signs off";

async function mixedChange(page: Page): Promise<number> {
  const response = await page.request.get(
    `${API_BASE_URL}/api/app/binders/${OWNER}/governance/changes?state=open`,
    { headers: { Origin: APP_BASE_URL } },
  );
  const { changes } = (await response.json()) as {
    changes: Array<{ number: number; title: string; body: string }>;
  };
  const found = changes.find(
    (change) => change.title === TITLE || change.body.startsWith(TITLE),
  );
  expect(found, "the seed's mixed change is open").toBeTruthy();
  return found!.number;
}

test("the overview says it changes who signs off, and why each rule applies", async ({
  page,
}) => {
  await signInAsAlice(page);
  const number = await mixedChange(page);
  await page.goto(`${APP_BASE_URL}/${OWNER}/governance/-/changes/${number}`);

  await expect(page.locator(".cmp-byline")).toContainText(
    "wants to publish 1 document and change who signs off",
  );
  // No "What this change does" (D9), and the rail's About panel.
  await expect(page.locator(".change-does")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "About this change" }),
  ).toContainText("Opened");

  // The approvals table, collapsed to one line, opens into the rules: the
  // rules rule first, each saying why it applies.
  const panel = page.getByRole("region", { name: "Approval rules" });
  await expect(panel).toContainText("Needs sign-off under");
  await panel.locator(".rev-rules-summary").click();
  const rows = panel.locator("tbody tr");
  await expect(rows.first()).toContainText("This change edits a sign-off rule");
  await expect(panel).toContainText("Hand Hygiene is in this folder");
  await expect(panel).toContainText("Applies to everything in Governance");
  await expect(
    panel.getByRole("link", { name: "Policy Office" }).first(),
  ).toHaveAttribute("href", `/${OWNER}/-/groups/policy-office`);
});

test("the Changes tab leads with the rule change", async ({ page }) => {
  await signInAsAlice(page);
  const number = await mixedChange(page);
  await page.goto(
    `${APP_BASE_URL}/${OWNER}/governance/-/changes/${number}/diffs`,
  );

  const rules = page.locator(".cmp-rules");
  await expect(rules).toBeVisible({ timeout: 30_000 });
  await expect(
    rules.locator(".cmp-rules-chip--added", { hasText: "Quality Committee" }),
  ).toBeVisible();
  await expect(rules).toContainText(
    "every document in Clinical Standards needs an approval from the Quality Committee as well",
  );
  await expect(rules).toContainText("starts with the next change");
  // A group in a chip says who is in it when rested on, and leads to its page.
  const quality = rules
    .locator(".cmp-rules-chip--added")
    .getByRole("link", { name: "Quality Committee" });
  await quality.hover();
  const card = rules.locator(".group-card");
  await expect(card).toContainText("Quality Committee");
  await expect(card).toContainText(/\d+ (person|people)|Nobody is in it/);
  await expect(quality).toHaveAttribute(
    "href",
    `/${OWNER}/-/groups/quality-committee`,
  );
  // First, above every document, and first in the tree.
  const stream = page.locator(".cmp-stream > *");
  await expect(stream.first()).toHaveClass(/cmp-rules/);
  await expect(page.locator(".cmp-tree .bs-row").first()).toContainText(
    "Who signs off",
  );
});

test("approving says it also changes who signs off, and what it counts toward", async ({
  page,
}) => {
  await signInAsAlice(page);
  const number = await mixedChange(page);
  await page.goto(`${APP_BASE_URL}/${OWNER}/governance/-/changes/${number}`);

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.locator(".rev-decision-confirm");
  await expect(confirm).toContainText("This also changes who signs off.");
  await expect(confirm).toContainText("Your approval counts toward:");
  await expect(confirm).toContainText("Who signs off · Policy Office");
  // Never given: the seed stays as it was.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
});
