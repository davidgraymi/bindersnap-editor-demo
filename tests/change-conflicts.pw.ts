/**
 * A change that clashes with the binder, resolved from inside the product.
 *
 * **What this is proving.** Two changes edit the same paragraph of one policy;
 * one is published; the other is now behind and cannot be brought up to date,
 * because git cannot choose between two wordings. The change's page has to
 * say so and offer the resolver, and the resolver has to leave the change up
 * to date with exactly the wording the person picked — on the change's
 * branch, not on the record.
 *
 * Integration rather than unit, because every claim is about refs: a merge
 * Gitea refused, then accepted; a branch that holds the chosen words.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";
import { LEGAL_VERSION } from "../packages/utils/legal";

test.describe.configure({ mode: "parallel", timeout: 240_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `clash-${suffix}`,
    email: `clash-${suffix}@users.bindersnap.local`,
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

async function signUp(credentials: Credentials): Promise<string> {
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      ...credentials,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  return match![1]!;
}

function policy(...paragraphs: string[]): string {
  return JSON.stringify(
    {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Hand Hygiene" }],
        },
        ...paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      ],
    },
    null,
    2,
  );
}

async function upload(
  session: string,
  url: string,
  fields: Record<string, string>,
  json: string,
): Promise<number> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([json], { type: "application/json" }),
    "document.json",
  );
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(url, {
    method: "POST",
    headers: { Cookie: `bindersnap_session=${session}`, Origin: APP_BASE_URL },
    body: form,
  });
  const body = await response.text();
  expect(response.status, body).toBe(201);
  return (JSON.parse(body) as { pullRequestNumber: number }).pullRequestNumber;
}

/** Approved by a second person, then published — retried as elsewhere. */
async function publish(
  session: string,
  approverSession: string,
  org: string,
  binder: string,
  change: number,
): Promise<void> {
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
    if (published.status === 200) return;
  }
  expect(published?.status, await published?.text()).toBe(200);
}

/**
 * A binder whose one policy two changes both reworded: the second is
 * published, so the first clashes. Answers with the one that clashes.
 */
async function provisionClash(): Promise<{
  session: string;
  org: string;
  binder: string;
  change: number;
}> {
  const session = await signUp(buildCredentials());
  const org = (
    (await (
      await fetch(`${API_BASE_URL}/api/app/organizations`, {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          acceptedTerms: LEGAL_VERSION,
          name: `Clash ${randomUUID().slice(0, 6)}`,
        }),
      })
    ).json()) as { organization: { name: string } }
  ).organization.name;
  const binder = (
    (await (
      await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ name: "Clinical Policies" }),
      })
    ).json()) as { workspace: { name: string } }
  ).workspace.name;

  const approver = buildCredentials();
  const approverSession = await signUp(approver);
  const joined = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: approver.username, owner: false }),
  });
  expect(joined.status, await joined.text()).toBeLessThan(300);

  const documents = `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`;
  const revisions = `${API_BASE_URL}/api/app/binders/${org}/${binder}/document-revisions`;

  const first = await upload(
    session,
    documents,
    { name: "Hand Hygiene" },
    policy("Wash your hands.", "Records are kept."),
  );
  await publish(session, approverSession, org, binder, first);

  // Two rewordings of the same paragraph, each a change of its own.
  const ours = await upload(
    session,
    revisions,
    { documentPath: "hand-hygiene" },
    policy(
      "Wash your hands with soap for twenty seconds.",
      "Records are kept.",
    ),
  );
  const theirs = await upload(
    session,
    revisions,
    { documentPath: "hand-hygiene" },
    policy("Use alcohol rub unless hands are soiled.", "Records are kept."),
  );
  await publish(session, approverSession, org, binder, theirs);

  return { session, org, binder, change: ours };
}

async function signInBrowser(page: Page, session: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
}

test("a change that clashes with the binder is resolved from its own page", async ({
  page,
}) => {
  const { session, org, binder, change } = await provisionClash();
  await signInBrowser(page, session);

  await page.goto(
    `${APP_BASE_URL}/${org}/${binder}?tab=changes&change=${change}`,
  );

  // Gitea computes whether it would merge after the push that made it
  // behind, so give the page a reload or two to hear about it.
  const resolve = page.getByRole("link", { name: "Resolve conflicts" });
  await expect(async () => {
    await page.reload();
    await expect(resolve).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await resolve.click();

  await expect(page).toHaveURL(/\/-\/changes\/\d+\/conflicts/);
  const file = page.locator(".conflict-file");
  await expect(file).toHaveCount(1);
  await expect(file).toContainText("Hand Hygiene");
  // Only the paragraph both changed is asked about, read as the policy.
  await expect(file.locator(".conflict-hunk")).toHaveCount(1);
  await expect(file.locator(".conflict-side").first()).toContainText(
    "Wash your hands with soap",
  );
  await expect(file.locator(".conflict-side").last()).toContainText(
    "Use alcohol rub",
  );

  const submit = page.getByRole("button", {
    name: "Resolve and bring up to date",
  });
  await expect(submit).toBeDisabled();
  await file.getByRole("button", { name: "Use this change's wording" }).click();
  await expect(submit).toBeEnabled();
  await submit.click();

  // Back on the change, and it is no longer behind.
  await expect(page).not.toHaveURL(/\/-\/changes\/\d+\/conflicts/, {
    timeout: 60_000,
  });
  await expect(page.locator(".change-behind")).toHaveCount(0, {
    timeout: 30_000,
  });

  // The change's branch holds the wording that was picked, and the record
  // still holds what was published.
  const detail = (await (
    await fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}`,
      { headers: authHeaders(session) },
    )
  ).json()) as { change: { branchName: string }; isBehind: boolean };
  expect(detail.isBehind).toBe(false);
  const onBranch = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/hand-hygiene?ref=${encodeURIComponent(detail.change.branchName)}`,
    { headers: authHeaders(session) },
  );
  expect(await onBranch.text()).toContain("with soap for twenty seconds");
  const onRecord = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/raw/hand-hygiene`,
    { headers: authHeaders(session) },
  );
  expect(await onRecord.text()).toContain("Use alcohol rub");
});

test("the conflicts read names each side and refuses stale heads", async () => {
  const { session, org, binder, change } = await provisionClash();

  const read = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/conflicts`,
    { headers: authHeaders(session) },
  );
  expect(read.status).toBe(200);
  const payload = (await read.json()) as {
    upToDate: boolean;
    canResolve: boolean;
    files: Array<{ key: string; kind: string; automatic: unknown }>;
  };
  expect(payload.upToDate).toBe(false);
  expect(payload.canResolve).toBe(true);
  expect(payload.files).toHaveLength(1);
  expect(payload.files[0]).toMatchObject({ kind: "editor", automatic: null });

  // A resolution about versions nobody is looking at any more is refused.
  const stale = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${change}/conflicts`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        headSha: "0".repeat(40),
        baseSha: "0".repeat(40),
        resolutions: [{ key: payload.files[0]!.key, take: "ours" }],
      }),
    },
  );
  expect(stale.status).toBe(409);
});
