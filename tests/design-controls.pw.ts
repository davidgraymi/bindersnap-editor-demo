/**
 * Controls in one row are one size.
 *
 * **The customer could see this, which is how it got written down:** *"Inputs,
 * selects and buttons are not one system — the 'Put it in' dropdown is visibly
 * a different height from the text inputs above it."* And *"not every page has
 * to be the same but the padding and style should be the same."*
 *
 * Two things had gone wrong, and both are the kind that only a running browser
 * can catch. There were two input implementations — `.bs-input` in the design
 * tokens and a `.create-document-input` that had grown up separately in the app
 * — so a field's height depended on which screen it was on. And a native
 * `<select>` does not agree with an `<input>` about its own height whatever
 * padding you give it, because the browser draws it its own way; a stylesheet
 * that looks identical produces two different boxes.
 *
 * So this is not a snapshot and not a review checklist. It walks the product,
 * finds every row that holds more than one control, and measures them. A row
 * whose controls disagree about how tall a control is fails, and the failure
 * names the row and the heights — which is exactly the report somebody needs
 * to fix it.
 *
 * **Rows, not the whole product.** A form field being taller than a button on
 * a different part of the page is fine and often right. Two controls side by
 * side at 49px and 32px is not, and it is the only thing that reads as sloppy
 * at a glance.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 240_000 });

interface MismatchedRow {
  row: string;
  controls: Array<{ cls: string; tag: string; h: number }>;
}

/**
 * Every horizontal row holding two or more controls that are not the same
 * height.
 *
 * Only direct children count. A control nested inside another element in the
 * row is in its own box and is not what somebody's eye compares.
 */
async function mismatchedRows(page: Page): Promise<MismatchedRow[]> {
  return page.evaluate(() => {
    const CONTROL =
      ".bs-input, .bs-btn, button, select, input:not([type='file'])";
    const found: MismatchedRow[] = [];

    for (const row of Array.from(document.querySelectorAll("*"))) {
      const style = getComputedStyle(row);
      if (style.display !== "flex" && style.display !== "inline-flex") continue;
      // A column is a stack. Nobody compares the heights of stacked things.
      if (style.flexDirection.startsWith("column")) continue;

      const controls = (Array.from(row.children) as HTMLElement[]).filter(
        (child) => child.matches(CONTROL),
      );
      if (controls.length < 2) continue;

      const heights = controls.map(
        (control) =>
          Math.round(control.getBoundingClientRect().height * 10) / 10,
      );
      // A control that is not on screen measures zero and is not a mismatch.
      if (heights.some((height) => height === 0)) continue;
      if (new Set(heights).size === 1) continue;

      found.push({
        row: (row as HTMLElement).className || row.tagName,
        controls: controls.map((control, index) => ({
          cls: control.className,
          tag: control.tagName.toLowerCase(),
          h: heights[index]!,
        })),
      });
    }

    return found;
  });
}

/** The failure, written so it names what to go and look at. */
function describe(rows: MismatchedRow[]): string {
  return rows
    .map(
      (row) =>
        `  .${row.row}\n` +
        row.controls
          .map(
            (control) => `      ${control.tag}.${control.cls} — ${control.h}px`,
          )
          .join("\n"),
    )
    .join("\n");
}

async function expectOneSizePerRow(page: Page, where: string): Promise<void> {
  const rows = await mismatchedRows(page);
  expect(
    rows,
    `Controls in one row are one size. On ${where}, these rows disagree:\n${describe(rows)}\n`,
  ).toEqual([]);
}

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `ctrl-${suffix}`,
    email: `ctrl-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

function authHeaders(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function provision(): Promise<{
  session: string;
  org: string;
  binder: string;
}> {
  const credentials = buildCredentials();
  const signup = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify(credentials),
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;

  const organization = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: `Riverbend ${randomUUID().slice(0, 6)}` }),
  });
  const org = (
    (await organization.json()) as { organization: { name: string } }
  ).organization.name;

  const created = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: "Clinical Policies" }),
  });
  const binder = ((await created.json()) as { workspace: { name: string } })
    .workspace.name;

  // One policy, so the binder has rows and an open change — which is what
  // makes the "Put it in" picker appear at all.
  const form = new FormData();
  form.set(
    "file",
    new Blob(["# Hand Hygiene\n"], { type: "text/markdown" }),
    "hand-hygiene.md",
  );
  form.set("name", "Hand Hygiene");
  form.set("folder", "Nursing");
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
  expect(added.status, await added.clone().text()).toBe(201);

  return { session, org, binder };
}

test("every row of controls in the product is one size", async ({ page }) => {
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  const screens: Array<[string, string]> = [
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["the binder's people", `${APP_BASE_URL}/${org}/${binder}?tab=people`],
    ["the sign-off rules", `${APP_BASE_URL}/${org}/${binder}?tab=sign-off`],
    ["the binder's settings", `${APP_BASE_URL}/${org}/${binder}?tab=settings`],
    ["the change requests", `${APP_BASE_URL}/${org}/${binder}?tab=changes`],
    ["the organization's people", `${APP_BASE_URL}/${org}?tab=people`],
    ["the library", `${APP_BASE_URL}/documents`],
    ["home", `${APP_BASE_URL}/home`],
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    // Every one of these pages loads something. Waiting for the shell alone
    // would measure a skeleton, which has no controls to disagree.
    await page.waitForLoadState("networkidle");
    await expectOneSizePerRow(page, where);
  }
});

test("the fields in a form are one size, picker included", async ({ page }) => {
  // The customer's own example: "the 'Put it in' dropdown is visibly a
  // different height from the text inputs above it." A native select will not
  // match an input on its own, whatever padding it is given — which is why
  // `.bs-input` takes the browser's drawing away and puts the arrow back by
  // hand.
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await page.getByRole("button", { name: "Add a policy" }).click();
  // The picker only exists once the binder has an open change, so waiting for
  // it is also what proves it rendered.
  await expect(page.locator(".create-document-modal select")).toBeVisible({
    timeout: 30_000,
  });

  const heights = await page
    .locator(
      ".create-document-form input:not([type='file']), .create-document-form select",
    )
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          Math.round(element.getBoundingClientRect().height * 10) / 10,
      ),
    );

  expect(heights.length).toBeGreaterThan(2);
  expect(
    new Set(heights).size,
    `the form's fields measured ${heights.join(", ")}px`,
  ).toBe(1);

  await expectOneSizePerRow(page, "the add-a-policy form");
});
