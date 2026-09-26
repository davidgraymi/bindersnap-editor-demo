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

test.describe.configure({ mode: "parallel", timeout: 240_000 });

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

/**
 * Wait for the real shell, not the skeleton that stands in for it.
 *
 * **`networkidle` is not "the app has rendered".** While `/auth/me` is in
 * flight, `App.tsx` renders `WorkspaceSkeleton`, whose markup is deliberately
 * the shape of the real thing — `.app-shell`, `.app-topnav`, `.app-main`, and
 * a `.home-page` inside it with the same padding. What it does **not** have is
 * a sidebar or a heading, and both of those are what these tests measure.
 *
 * So a measurement taken during that window reports a page 1144px wide
 * starting at x=65 — the page box at its own max-width, because there is no
 * 220px sidebar constraining it — with `headingSize: null`. Which is exactly
 * the shape CI reported when this flaked: the numbers were not a layout
 * regression, they were the skeleton.
 *
 * It never reproduced locally because the window is a few milliseconds
 * against a warm API; CI is slower and cold, so it lands in it perhaps one run
 * in three, on whichever screen happens to be slowest that time. That is why
 * the failures moved between "the organization" and "the review queue" across
 * retries rather than naming one page.
 *
 * `.app-shell--skeleton` is the one class that tells the two apart, so this
 * waits for a shell that does not carry it.
 */
async function settleOnRealShell(page: Page): Promise<void> {
  await page.locator(".app-shell:not(.app-shell--skeleton)").waitFor();
  await page.waitForLoadState("networkidle");
  // **And the page's own skeleton, not only the shell's.** A screen renders
  // its heading first and its body as placeholder rows while the read is in
  // flight, so `networkidle` can be true of the shell while the page in it is
  // still a skeleton. Measuring then reads placeholder chrome as content —
  // which is what CI caught on a slower machine than this was written on, and
  // is a fault in the measurement rather than in the page.
  await expect(page.locator(".bs-skeleton")).toHaveCount(0, {
    timeout: 30_000,
  });
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
    // Every one of these pages loads something, and the skeleton that stands
    // in while it does has no controls to disagree — so wait for both the
    // real shell and the data.
    await settleOnRealShell(page);
    await expectOneSizePerRow(page, where);
  }

  // **A row that only exists once somebody presses something.** A sign-off
  // rule's own pickers are drawn only while it is being changed, so walking
  // the page alone measures nothing — and a 49px select beside a 32px button
  // once sat there unnoticed until somebody opened it by hand. A guard only
  // sees what the page renders, which is worth remembering when adding
  // screens to the list above.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=sign-off`);
  await settleOnRealShell(page);
  const foot = page.locator("#sign-off .bs-panel-foot").first();
  await foot
    .getByRole("combobox", { name: "What has to be signed off" })
    .selectOption("binder");
  await foot
    .getByRole("combobox", { name: "Which group signs it off" })
    .selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add a rule" }).click();
  await page
    .getByRole("button", { name: /^Change the rule for / })
    .first()
    .click();
  await expect(
    page.locator("#sign-off .bs-row--on").getByRole("combobox", {
      name: "What has to be signed off",
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expectOneSizePerRow(page, "a sign-off rule being changed");
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
  await page.getByRole("button", { name: "Add a document" }).click();
  // **Wait for the picker that loads, not for the first one drawn.** "Put it
  // in" only exists once the binder has an open change and is filled from a
  // read; the folder picker is drawn immediately. Waiting for the wrong one
  // measures a form that is still one field short.
  await expect(page.locator("#change-target")).toBeVisible({ timeout: 30_000 });

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
  ];

  const shapes: Array<{ where: string; shape: Record<string, unknown> }> = [];

  for (const [where, url] of screens) {
    await page.goto(url);
    await settleOnRealShell(page);
    // And the page's own heading, because it is one of the four things
    // measured below and a route can still be a render behind its shell.
    await page.locator(".bs-title, .doc-header-title").first().waitFor();

    const shape = await page.evaluate(() => {
      const main = document.querySelector(".app-main");
      const root = main?.firstElementChild as HTMLElement | undefined;
      if (!root) return null;
      const box = root.getBoundingClientRect();
      const heading = main!.querySelector(".bs-title, .doc-header-title");
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
 * Nothing holds content on a binder screen except the three containers.
 *
 * **This is the rule that makes the grammar still true a year from now**, and
 * it is the one the redesign exists for: six tabs were built one at a time and
 * each invented its own container, so walking Documents → People → Sign-off
 * rules → Settings crossed four container idioms in four clicks. The
 * customer's words: *"the content it renders … looks like a different web
 * page."*
 *
 * So a binder screen's content root may hold only three things —
 * `.bs-panel` (a list), `.bs-fields` (a form), `.bs-note` (a consequence) —
 * plus the chrome that is not content: the page's own head, a section that
 * groups them, the spine, the draft bar, the rail layout.
 *
 * Checked at the content root rather than at every depth, which is where the
 * idioms actually diverged: a panel containing a bespoke row is a detail, and
 * a bespoke box sitting beside a panel is the defect.
 */
test("nothing but the three containers holds content in a binder", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  /** Chrome, not content: these group the containers or title the page. */
  const ALLOWED = [
    "bs-panel",
    "bs-fields",
    "bs-note",
    "bs-section",
    "bs-pagehead",
    "bs-crumbs",
    "bs-spine",
    "bs-with-rail",
    "bs-rail",
    "bs-draftbar",
    "bs-empty",
    "bs-section-note",
    "binder-strip",
    "change-main",
  ];

  const screens: Array<[string, string]> = [
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["its change requests", `${APP_BASE_URL}/${org}/${binder}?tab=changes`],
    ["its history", `${APP_BASE_URL}/${org}/${binder}?tab=history`],
    ["its settings", `${APP_BASE_URL}/${org}/${binder}?tab=settings`],
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    await settleOnRealShell(page);
    await page.locator(".app-main h1").first().waitFor();

    const strays = await page.evaluate((allowed) => {
      const root = document.querySelector(".binder-pane");
      if (!root) return null;

      return (Array.from(root.children) as HTMLElement[])
        .filter((child) => {
          // An element with nothing in it holds no content by definition.
          if ((child.textContent ?? "").trim() === "") return false;
          return !allowed.some((name) => child.classList.contains(name));
        })
        .map((child) => ({
          tag: child.tagName.toLowerCase(),
          cls: child.className,
          text: (child.textContent ?? "").trim().slice(0, 40),
        }));
    }, ALLOWED);

    expect(strays, `${where} rendered no binder page`).not.toBeNull();
    expect(
      strays,
      `On ${where}, something outside the three containers holds content:\n` +
        (strays ?? [])
          .map((s) => `      ${s.tag}.${s.cls} — “${s.text}”`)
          .join("\n") +
        "\n",
    ).toEqual([]);
  }
});

/**
 * The marketing eyebrow never appears inside the app.
 *
 * `.bs-label` is coral, uppercase, monospace, wide-tracked — the landing
 * page's section eyebrow, which is right where it is. It had **26 call sites
 * in the app**, standing in for ordinary form labels: `WHAT YOU ARE ASKING
 * FOR`, `CHOOSE FILE`, `WHO CAN SEE THIS BINDER?`. Uppercase monospace coral
 * is the loudest "developer tool" signal the product has, and it was on the
 * labels of every form somebody fills in.
 *
 * `.bs-field-label` replaces it: Geist, sentence case, the weight of a label
 * rather than of a banner. This is the rule that keeps the eyebrow on the
 * landing page, where it belongs.
 */
test("the marketing eyebrow never labels a field in the app", async ({
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
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["its settings", `${APP_BASE_URL}/${org}/${binder}?tab=settings`],
    ["the organization", `${APP_BASE_URL}/${org}`],
    ["the organization's people", `${APP_BASE_URL}/${org}?tab=people`],
    ["the library", `${APP_BASE_URL}/documents`],
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    await settleOnRealShell(page);

    const eyebrows = await page
      .locator(".app-main .bs-label")
      .evaluateAll((elements) =>
        elements.map((element) => (element.textContent ?? "").trim()),
      );

    expect(eyebrows, `${where} labels something with the eyebrow`).toEqual([]);
  }

  // And the modal that carries the product's primary act, which is where the
  // loudest of them was.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await page.getByRole("button", { name: "Add a document" }).click();
  await expect(page.locator(".create-document-modal")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".create-document-modal .bs-label")).toHaveCount(0);
});

/**
 * Every binder screen has exactly one `h1`, and it names the subject.
 *
 * **The binder used to be the page's only `h1`, on every screen it held.** A
 * policy then rendered its own name as a second `h1` at the same size, and a
 * change request got an `h2` — so the page's loudest heading named the thing
 * you were visibly inside, and the thing the page was actually about was a
 * rank below it.
 *
 * D1 is what fixes it: the binder is named once, in the sidebar, and each
 * screen's title belongs to its own subject. This is the rule that keeps it
 * true — written by putting the defect back first and watching it fail with
 * two headings named.
 *
 * **The policy's own text is not the page's chrome.** A markdown policy that
 * opens `# Hand Hygiene` renders an `h1`, and that heading belongs to the
 * document rather than to the screen around it — so the rendered sheet is
 * excluded, and everything the app itself draws is counted.
 */
test("every binder screen has exactly one heading of its own", async ({
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
    ["the binder", `${APP_BASE_URL}/${org}/${binder}`],
    ["its change requests", `${APP_BASE_URL}/${org}/${binder}?tab=changes`],
    ["its history", `${APP_BASE_URL}/${org}/${binder}?tab=history`],
    ["its settings", `${APP_BASE_URL}/${org}/${binder}?tab=settings`],
    ["a policy", `${APP_BASE_URL}/${org}/${binder}/nursing/hand-hygiene`],
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    await settleOnRealShell(page);
    await page.locator(".app-main h1").first().waitFor();

    const headings = await page
      .locator(".app-main h1:not(.doc-preview-prose h1)")
      .evaluateAll((elements) =>
        elements.map((element) => (element.textContent ?? "").trim()),
      );

    expect(
      headings,
      `${where} should have exactly one h1, and it should name the subject`,
    ).toHaveLength(1);
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
  ];

  for (const [where, url] of screens) {
    await page.goto(url);
    await settleOnRealShell(page);

    const louder = await page.evaluate(() => {
      const main = document.querySelector(".app-main");
      if (!main) return null;
      const title = main.querySelector(".bs-title, .doc-header-title");
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

/**
 * A menu is never clipped by the thing it opens from.
 *
 * **The customer could not use the reviewer search:** *"when I click the
 * button to add a reviewer the search is clipped to the 'Approvals' squircle
 * making it very difficult to use."* A `.bs-panel` is rounded by
 * `overflow: hidden`, and an absolutely positioned popover inside one is cut
 * to whatever slice of panel happens to sit below its button — which on the
 * change request's rail was about twenty pixels.
 *
 * It is the kind of failure a stylesheet diff cannot show: both rules are
 * correct on their own, and it is only their meeting that breaks. So this
 * opens the picker for real and measures what is actually on the screen —
 * every edge inside the viewport, and the search box hit-testable at its own
 * centre rather than merely present in the DOM.
 */
test("a popover is not clipped by the panel it opens from", async ({
  page,
}) => {
  const { session, org, binder } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=changes&change=1`);
  await settleOnRealShell(page);

  const add = page.locator(".rev-reviewers-add");
  await add.waitFor();
  await add.click();

  const measured = await measurePopover(
    page,
    ".rev-picker",
    ".rev-picker-input",
  );
  assertNotClipped(measured, "the reviewer picker");

  // **The same rule, on the other popover that lives inside a panel.** One
  // instance is a bug fixed; two is a rule, and the draft picker sits in the
  // tree's own bar — another `.bs-panel`, another squircle.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}`);
  await settleOnRealShell(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const pick = page.locator(".bs-draftpick");
  await pick.waitFor({ timeout: 30_000 });
  await pick.click();

  assertNotClipped(
    await measurePopover(page, ".bs-draftmenu", ".bs-draftmenu-pick"),
    "the draft picker",
  );
});

/** What is actually on the screen, rather than what is in the DOM. */
async function measurePopover(
  page: Page,
  popover: string,
  inner: string,
): Promise<{
  offscreen: boolean;
  height: number;
  fieldHeight: number;
  reachable: boolean;
} | null> {
  // **Visible, not merely present.** Both popovers are placed by measuring
  // their button after paint, and render `visibility: hidden` until they know
  // where they go — so measuring the instant after the click hit-tests through
  // them to whatever is behind, which looks exactly like being clipped.
  await page.locator(popover).waitFor({ state: "visible", timeout: 30_000 });

  return page.evaluate(
    ([popoverSelector, innerSelector]) => {
      const picker = document.querySelector(popoverSelector!);
      const input = document.querySelector(innerSelector!);
      if (!picker || !input) return null;

      const box = picker.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const centre = document.elementFromPoint(
        field.left + field.width / 2,
        field.top + field.height / 2,
      );

      return {
        offscreen:
          box.left < 0 ||
          box.top < 0 ||
          box.right > window.innerWidth ||
          box.bottom > window.innerHeight,
        height: Math.round(box.height),
        fieldHeight: Math.round(field.height),
        // Clipped by an ancestor and the point belongs to whatever covers it.
        reachable: centre === input || input.contains(centre),
      };
    },
    [popover, inner] as const,
  );
}

function assertNotClipped(
  measured: Awaited<ReturnType<typeof measurePopover>>,
  what: string,
): void {
  expect(measured, `${what} never opened`).not.toBeNull();
  expect(measured!.offscreen, `${what} opened partly off the screen`).toBe(
    false,
  );
  expect(
    measured!.height,
    `${what} is ${measured!.height}px tall — what is inside it is ${measured!.fieldHeight}px, so it is being cut off`,
  ).toBeGreaterThan(measured!.fieldHeight);
  expect(
    measured!.reachable,
    `${what} cannot be clicked at its own centre`,
  ).toBe(true);
}

/**
 * **A list is scanned down its columns, so the columns have to stay put.**
 *
 * The customer, of the change list: *"I noticed that when there is a
 * conversation count that it moves the status to the left. I want it to be
 * easy on peoples eyes and keep the rows aligned, so make these columns
 * static so that the status doesn't shift left or right."*
 *
 * The count was rendered only on rows that had one, so a row with a
 * conversation pushed its own standing left and a stack of rows zig-zagged.
 * Nothing in a stylesheet says so — both rules were right — and in a diff it
 * reads as a sensible "don't draw a zero". It is only visible in a browser,
 * with two rows that differ, which is what this is.
 */
test("a change list's columns hold their place, commented or not", async ({
  page,
}) => {
  const { session, org, binder } = await provision();

  // A second policy, so the binder has a second change — one to comment on
  // and one to leave alone.
  const second = new FormData();
  second.set(
    "file",
    new Blob(["# Staff Handbook\n"], { type: "text/markdown" }),
    "staff-handbook.md",
  );
  second.set("name", "Staff Handbook");
  const added = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    {
      method: "POST",
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
      body: second,
    },
  );
  expect(added.status, await added.clone().text()).toBe(201);

  const said = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/1/discussions`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ body: "Does this cover the night shift?" }),
    },
  );
  expect(said.status, await said.clone().text()).toBe(201);

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${APP_BASE_URL}/${org}/${binder}?tab=changes`);
  await settleOnRealShell(page);

  const rows = page.locator(".change-row");
  await expect(rows).toHaveCount(2, { timeout: 30_000 });

  // One row carries a conversation and the other does not — without that the
  // measurement below would pass on a list that has the bug.
  const counts = await page
    .locator(".change-row .change-row-comments")
    .allTextContents();
  expect(counts.filter((text) => text.trim() !== "")).toHaveLength(1);
  expect(counts.filter((text) => text.trim() === "")).toHaveLength(1);

  const lefts = await page
    .locator(".change-row .change-standing")
    .evaluateAll((standings) =>
      standings.map(
        (standing) =>
          Math.round(standing.getBoundingClientRect().left * 10) / 10,
      ),
    );
  expect(lefts).toHaveLength(2);
  expect(
    new Set(lefts).size,
    `the standing sits at ${lefts.join(" and ")} — a list that zig-zags`,
  ).toBe(1);
});
