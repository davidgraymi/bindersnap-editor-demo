/**
 * Change emails, end to end (issue #665): the four moments somebody is waiting
 * on, the words they arrive in, and the ways to stop them.
 *
 * Built from fresh accounts and a fresh organization, so no other suite's
 * emails can be mistaken for these. Every address is unique to the run.
 */
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm, waitForEmail } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 180_000 });

interface Person {
  username: string;
  email: string;
  password: string;
  session: string;
}

async function signUp(prefix: string): Promise<Person> {
  const suffix = randomUUID().slice(0, 12);
  const username = `${prefix}-${suffix}`;
  const email = `${username}@users.bindersnap.local`;
  const password = `Bindersnap-${suffix}!`;
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: prefix === "owner" ? "Olivia" : "Rafael",
      lastName: prefix === "owner" ? "Owens" : "Reyes",
      username,
      email,
      password,
    }),
  });
  expect(response.status).toBe(200);
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  return { username, email, password, session };
}

async function call(
  session: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path}: ${text}`).toBeLessThan(300);
  return text === "" ? {} : JSON.parse(text);
}

async function addPolicy(
  session: string,
  org: string,
  binder: string,
  name: string,
): Promise<number> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([`# ${name}\n\nThe policy text.\n`], { type: "text/markdown" }),
    `${name.toLowerCase().replace(/\s+/g, "-")}.md`,
  );
  form.set("name", name);
  form.set("folder", "");
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
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return (JSON.parse(text) as { pullRequestNumber: number }).pullRequestNumber;
}

async function setUp() {
  const owner = await signUp("owner");
  const reviewer = await signUp("reviewer");
  const created = await call(owner.session, "POST", "/api/app/organizations", {
    name: `Mail ${randomUUID().slice(0, 6)}`,
  });
  const org = (created.organization as { name: string }).name;
  const binder = (
    (
      await call(owner.session, "POST", `/api/app/orgs/${org}/binders`, {
        name: "Policies",
      })
    ).workspace as { name: string }
  ).name;
  await call(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: reviewer.username,
  });
  return { owner, reviewer, org, binder };
}

test("a change's review, request, readiness and publish each reach the right inbox", async () => {
  const { owner, reviewer, org, binder } = await setUp();
  const change = await addPolicy(owner.session, org, binder, "Hand Hygiene");
  const changeLink = `${APP_BASE_URL}/${org}/${binder}/-/changes/${change}`;

  // 1. Asked to review.
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [reviewer.username] },
  );
  const asked = await waitForEmail(reviewer.email, /^Review requested: /);
  expect(asked.from).toContain("Bindersnap");
  expect(asked.html).toContain("Olivia Owens asked you to review a change");
  expect(asked.links).toContain(changeLink);
  expect(asked.html.toLowerCase()).not.toContain("pull request");
  // Every optional email says how to stop it, in the body and in the header
  // a mail client turns into its own unsubscribe button.
  expect(
    asked.links.some((href) => href.includes("/-/unsubscribe?token=")),
  ).toBe(true);
  expect(asked.headers["List-Unsubscribe"]).toMatch(
    /^<http:\/\/localhost:\d+\/email\/unsubscribe\?token=[\w-]+>$/,
  );
  expect(asked.headers["List-Unsubscribe-Post"]).toBe(
    "List-Unsubscribe=One-Click",
  );

  // 2. Asked for changes, with what the reviewer said.
  await call(
    reviewer.session,
    "POST",
    `/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
    { event: "REQUEST_CHANGES", body: "Cite the WHO guideline." },
  );
  const changes = await waitForEmail(owner.email, /^Changes requested: /);
  expect(changes.html).toContain("Cite the WHO guideline.");
  expect(changes.links).toContain(changeLink);

  // 3. Approved, and with that, ready. Retried: Gitea processes the change's
  // opening push a moment late and can drop an approval made against the
  // head it had before (see stale-approvals.pw.ts).
  await expect
    .poll(
      async () => {
        await call(
          reviewer.session,
          "POST",
          `/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
          { event: "APPROVE" },
        );
        return countEmailsMatching(owner.email, /^Ready to publish: /);
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBeGreaterThanOrEqual(1);
  await waitForEmail(owner.email, /^Ready to publish: /);

  // 4. Published: the reviewer was part of it.
  await call(
    owner.session,
    "POST",
    `/api/app/binders/${org}/${binder}/changes/${change}/publish`,
    {},
  );
  const published = await waitForEmail(reviewer.email, /^Published: /);
  expect(published.html).toContain("Olivia Owens published");

  // Nobody is emailed about their own act.
  expect(await countEmailsMatching(owner.email, /^Published: /)).toBe(0);
  expect(
    await countEmailsMatching(reviewer.email, /^Changes requested: /),
  ).toBe(0);
});

async function countEmailsMatching(to: string, subject: RegExp) {
  const response = await fetch(
    `http://localhost:${process.env.MAILPIT_PORT ?? "8025"}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  );
  const body = (await response.json()) as { messages: { Subject: string }[] };
  return body.messages.filter((m) => subject.test(m.Subject)).length;
}

test("the one-click unsubscribe turns change emails off, without signing in", async () => {
  const { owner, reviewer, org, binder } = await setUp();
  const change = await addPolicy(owner.session, org, binder, "Staff Handbook");
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [reviewer.username] },
  );
  const asked = await waitForEmail(reviewer.email, /^Review requested: /);
  const oneClick = asked.headers["List-Unsubscribe"]!.slice(1, -1);

  // What Gmail sends: a bare POST, no cookie, no Origin.
  const response = await fetch(oneClick, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  expect(response.status).toBe(200);

  const prefs = await call(
    reviewer.session,
    "GET",
    "/api/app/account/email-preferences",
  );
  expect(prefs.preferences).toEqual({
    reviewRequested: false,
    changesRequested: false,
    readyToPublish: false,
    published: false,
  });

  // Asked again, after taking them off and on: no email this time.
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [] },
  );
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [reviewer.username] },
  );
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  expect(await countEmailsMatching(reviewer.email, /^Review requested: /)).toBe(
    1,
  );
});

test("the unsubscribe page asks before it acts, and settings turn emails back on", async ({
  page,
}) => {
  const { owner, reviewer, org, binder } = await setUp();
  const change = await addPolicy(owner.session, org, binder, "Fire Safety");
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [reviewer.username] },
  );
  const asked = await waitForEmail(reviewer.email, /^Review requested: /);
  const unsubscribe = asked.links.find((href) =>
    href.includes("/-/unsubscribe?token="),
  )!;

  // A link scanner opening the page changes nothing.
  await page.goto(unsubscribe);
  await expect(
    page.getByRole("heading", { name: "Stop change emails?" }),
  ).toBeVisible();
  expect(
    (await call(reviewer.session, "GET", "/api/app/account/email-preferences"))
      .preferences,
  ).toMatchObject({ reviewRequested: true });

  await page.getByRole("button", { name: "Turn off change emails" }).click();
  await expect(
    page.getByRole("heading", { name: "You will not get change emails." }),
  ).toBeVisible();

  // Signed in, the settings page shows it, and one box turns one topic back on.
  await page.goto(`${APP_BASE_URL}/-/login`);
  await page.getByLabel("Username or Email").fill(reviewer.username);
  await page.getByLabel("Password").fill(reviewer.password);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto(`${APP_BASE_URL}/-/user_settings/profile#email`);

  const box = page.getByLabel("Someone asks you to review a change");
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Someone asks you to review a change"),
  ).toBeChecked();
  await expect(
    page.getByLabel("A change you were part of is published"),
  ).not.toBeChecked();
});

async function signIn(page: Page, person: Person) {
  await page.goto(`${APP_BASE_URL}/-/login`);
  await page.getByLabel("Username or Email").fill(person.username);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).not.toHaveURL(/login/);
}

test("done in the app, each step emails the next person, and each link opens the change", async ({
  browser,
}) => {
  const { owner, reviewer, org, binder } = await setUp();
  const change = await addPolicy(owner.session, org, binder, "Hand Hygiene");
  const ownerPage = await (await browser.newContext()).newPage();
  const reviewerPage = await (await browser.newContext()).newPage();
  await signIn(ownerPage, owner);
  await signIn(reviewerPage, reviewer);

  // The owner asks for a review from the change's own page.
  await ownerPage.goto(`${APP_BASE_URL}/${org}/${binder}/-/changes/${change}`);
  await ownerPage.getByRole("button", { name: "Reviewer" }).click();
  await ownerPage.getByLabel("Search for a reviewer").fill(reviewer.username);
  await ownerPage
    .getByRole("button", { name: new RegExp(`@${reviewer.username}$`) })
    .click();

  // The reviewer follows the email's button, and is on the change.
  const asked = await waitForEmail(reviewer.email, /^Review requested: /);
  await reviewerPage.goto(
    asked.links.find((href) => href.includes("/-/changes/"))!,
  );
  await expect(
    reviewerPage.getByRole("heading", { name: "Add Hand Hygiene", level: 1 }),
  ).toBeVisible();

  // Asks for changes, in words the owner reads in the email.
  await reviewerPage.getByRole("button", { name: "Ask for changes" }).click();
  await reviewerPage
    .getByRole("textbox", { name: "Describe what needs to change…" })
    .fill("Name the soap dispensers by ward.");
  await reviewerPage.getByRole("button", { name: "Send" }).click();
  const changes = await waitForEmail(owner.email, /^Changes requested: /);
  expect(changes.html).toContain("Name the soap dispensers by ward.");

  // Then approves, and the owner hears it is ready.
  await reviewerPage.getByRole("button", { name: "Approve" }).click();
  await reviewerPage.getByRole("button", { name: "Confirm approval" }).click();
  const ready = await waitForEmail(owner.email, /^Ready to publish: /, {
    timeout: 60_000,
  });

  // The owner publishes from the ready email's link.
  await ownerPage.goto(
    ready.links.find((href) => href.includes("/-/changes/"))!,
  );
  await ownerPage.getByRole("button", { name: "Publish" }).click();
  const published = await waitForEmail(reviewer.email, /^Published: /);
  expect(published.html).toContain("Olivia Owens published");
});

test("one email turned off in settings stops that one, and only that one", async ({
  page,
}) => {
  const { owner, reviewer, org, binder } = await setUp();

  await signIn(page, reviewer);
  await page.goto(`${APP_BASE_URL}/-/user_settings/profile#email`);
  await page.getByLabel("Someone asks you to review a change").uncheck();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();

  const change = await addPolicy(owner.session, org, binder, "Fire Safety");
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${change}/assignments`,
    { reviewers: [reviewer.username] },
  );
  await expect
    .poll(
      async () => {
        await call(
          reviewer.session,
          "POST",
          `/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
          { event: "APPROVE" },
        );
        return countEmailsMatching(owner.email, /^Ready to publish: /);
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .toBe(1);
  await call(
    owner.session,
    "POST",
    `/api/app/binders/${org}/${binder}/changes/${change}/publish`,
    {},
  );

  // Published still comes. The outbox sends in order, so by the time it is
  // here, a review request would have been too.
  await waitForEmail(reviewer.email, /^Published: /);
  expect(await countEmailsMatching(reviewer.email, /^Review requested: /)).toBe(
    0,
  );
});
