/**
 * The design system, measured in a browser rather than reviewed in a diff.
 *
 * Two rules so far, both of which the customer noticed before we did:
 * **controls in one row are one size**, and **every page has the same shape**.
 * Neither is a thing you can check by reading a stylesheet — the rules looked
 * fine both times — and both failures read as sloppiness at a glance while
 * being nearly invisible in review.
 *
 * ── Controls in one row are one size ──
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

  // **A row that only exists once somebody presses something.** The sign-off
  // editor draws no rule row until a rule is added, so walking the page alone
  // measured nothing — and a 49px select beside a 32px button sat there
  // unnoticed until somebody opened it by hand. A guard only sees what the
  // page renders, which is worth remembering when adding screens to the list
  // above.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=sign-off`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Add a rule" }).click();
  await expect(
    page.getByRole("combobox", { name: "What has to be signed off" }),
  ).toBeVisible({ timeout: 30_000 });
  await expectOneSizePerRow(page, "a sign-off rule being written");
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

/**
 * Every page begins in the same place, at the same width, under a heading of
 * the same size.
 *
 * **This is what "the padding and style should be the same" measures to.**
 * There were three page boxes — 1054px, 880px and 1040px — and three heading
 * sizes, so walking from Home to Documents to Activity moved the content
 * sideways by up to 87px and resized the title twice. Nothing was broken;
 * everything was slightly different, which is worse, because it reads as three
 * products rather than one.
 *
 * The binder's heading sits lower than the rest and that is not a fault: it is
 * a level deeper and has a breadcrumb above it. So the top of the heading is
 * not compared — the left edge, the width and the type size are.
 */
test("every page begins in the same place, at the same size", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  const screens: Array<[string, string]> = [
    ["home", `${APP_BASE_URL}/home`],
    ["the library", `${APP_BASE_URL}/documents`],
    ["the review queue", `${APP_BASE_URL}/changes`],
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["the organization", `${APP_BASE_URL}/${org}`],
    ["the activity log", `${APP_BASE_URL}/activity`],
  ];

  const shapes: Array<{ where: string; shape: Record<string, unknown> }> = [];

  for (const [where, url] of screens) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");

    const shape = await page.evaluate(() => {
      const main = document.querySelector(".app-main");
      const root = main?.firstElementChild as HTMLElement | undefined;
      if (!root) return null;
      const box = root.getBoundingClientRect();
      const heading = main!.querySelector(
        ".doc-header-title, .docs-title, .activity-heading",
      );
      return {
        left: Math.round(box.left),
        width: Math.round(box.width),
        padding: getComputedStyle(root).padding,
        headingSize: heading ? getComputedStyle(heading).fontSize : null,
      };
    });

    expect(shape, `${where} rendered no page inside the shell`).not.toBeNull();
    shapes.push({ where, shape: shape as Record<string, unknown> });
  }

  // Compared against the first rather than against a number written here: what
  // matters is that they agree, and pinning the value would make this a test
  // of a decision rather than of consistency.
  const [first, ...rest] = shapes;
  for (const other of rest) {
    expect(
      other.shape,
      `${other.where} is not the same shape as ${first!.where}`,
    ).toEqual(first!.shape);
  }
});

/**
 * Nothing inside a page is bigger than the page's own name.
 *
 * **A hierarchy that inverts reads as a brochure, not a tool**, which is the
 * whole of the customer's direction: *"We need less editorial and more useful
 * tool."* The activity log had a 42px serif headline on a placeholder card
 * sitting under a 26px page title — the loudest thing on the page was the part
 * that does nothing yet.
 *
 * Measured rather than judged: the page's own heading is found, then every
 * other heading on the page, and any that is larger fails by name. Equal is
 * allowed — two things of the same rank is a layout decision. Larger is not.
 */
test("no heading on a page outranks the page's own title", async ({ page }) => {
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  const screens: Array<[string, string]> = [
    ["home", `${APP_BASE_URL}/home`],
    ["the library", `${APP_BASE_URL}/documents`],
    ["the review queue", `${APP_BASE_URL}/changes`],
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["the organization", `${APP_BASE_URL}/${org}`],
    ["the activity log", `${APP_BASE_URL}/activity`],
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");

    const louder = await page.evaluate(() => {
      const main = document.querySelector(".app-main");
      if (!main) return null;
      const title = main.querySelector(
        ".doc-header-title, .docs-title, .activity-heading, .home-greeting",
      );
      if (!title) return [];
      const titleSize = parseFloat(getComputedStyle(title).fontSize);

      return Array.from(main.querySelectorAll("h1, h2, h3, h4"))
        .filter((heading) => heading !== title)
        .map((heading) => ({
          text: (heading.textContent ?? "").trim().slice(0, 40),
          cls: (heading as HTMLElement).className,
          size: parseFloat(getComputedStyle(heading).fontSize),
        }))
        .filter((heading) => heading.size > titleSize);
    });

    expect(louder, `${where} rendered no page inside the shell`).not.toBeNull();
    expect(
      louder,
      `On ${where}, something inside the page is louder than the page:\n` +
        (louder ?? [])
          .map((h) => `      ${h.size}px — ${h.cls || "?"} — “${h.text}”`)
          .join("\n") +
        "\n",
    ).toEqual([]);
  }
});
