/**
 * A binder's "A new version clears the approvals already collected" setting.
 *
 * Gitea's `dismiss_stale_approvals`, on by default. When it is on, an approval
 * is for exactly what the reviewer read: change what the change proposes and
 * the approval no longer counts. When an admin turns it off, the approval
 * stands through later edits — a looser rule some binders want, and one the
 * product must keep honestly.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 180_000 });

function headers(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(): Promise<{ username: string; session: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `stale-${suffix}`;
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      username,
      email: `${username}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(200);
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  return { username, session };
}

async function json(
  session: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: headers(session),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path}: ${text}`).toBeLessThan(300);
  return text === "" ? {} : JSON.parse(text);
}

/** Add a policy, into a change if one is named; answer with the change. */
async function addPolicy(
  session: string,
  org: string,
  binder: string,
  name: string,
  change?: number,
): Promise<number> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([`# ${name}\n\nThe policy text.\n`], { type: "text/markdown" }),
    `${name.toLowerCase().replace(/\s+/g, "-")}.md`,
  );
  form.set("name", name);
  form.set("folder", "");
  if (change !== undefined) form.set("changeNumber", String(change));
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

async function approvalCount(
  session: string,
  org: string,
  binder: string,
  change: number,
): Promise<number> {
  const detail = await json(
    session,
    "GET",
    `/api/app/binders/${org}/${binder}/changes/${change}`,
  );
  return (detail.change as { approvalCount: number }).approvalCount;
}

/** An owner, a binder, and a colleague in the organization to review. */
async function setUp(): Promise<{
  owner: string;
  reviewer: string;
  org: string;
  binder: string;
}> {
  const owner = await signUp();
  const reviewer = await signUp();
  const created = await json(owner.session, "POST", "/api/app/organizations", {
    name: `Stale ${randomUUID().slice(0, 6)}`,
  });
  const org = (created.organization as { name: string }).name;
  const binder = (
    (
      await json(owner.session, "POST", `/api/app/orgs/${org}/binders`, {
        name: "Policies",
      })
    ).workspace as { name: string }
  ).name;
  await json(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: reviewer.username,
  });
  return { owner: owner.session, reviewer: reviewer.session, org, binder };
}

/**
 * Approve, and wait until the approval is on the change.
 *
 * Retried, because Gitea processes the change's opening push asynchronously
 * and, with stale approvals dismissed, drops an approval recorded against the
 * head it had a moment before — the same race `binder-archive.pw.ts` meets.
 */
async function approve(
  reviewer: string,
  owner: string,
  org: string,
  binder: string,
  change: number,
): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await json(
      reviewer,
      "POST",
      `/api/app/binders/${org}/${binder}/changes/${change}/reviews`,
      { event: "APPROVE" },
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if ((await approvalCount(owner, org, binder, change)) === 1) return;
  }
  expect(await approvalCount(owner, org, binder, change)).toBe(1);
}

test("with the setting on, adding to an approved change clears the approval", async () => {
  const { owner, reviewer, org, binder } = await setUp();

  const rules = await json(
    owner,
    "GET",
    `/api/app/binders/${org}/${binder}/settings`,
  );
  expect(
    (rules.rules as { dismissStaleApprovals: boolean }).dismissStaleApprovals,
  ).toBe(true);

  const change = await addPolicy(owner, org, binder, "Hand Hygiene");
  await approve(reviewer, owner, org, binder, change);

  await addPolicy(owner, org, binder, "Staff Handbook", change);

  // Gitea dismisses on the push, which it processes a moment later.
  await expect
    .poll(() => approvalCount(owner, org, binder, change), { timeout: 20_000 })
    .toBe(0);
});

test("with the setting off, the approval stands through later edits", async () => {
  const { owner, reviewer, org, binder } = await setUp();

  await json(owner, "PATCH", `/api/app/binders/${org}/${binder}/rules`, {
    dismissStaleApprovals: false,
  });

  const change = await addPolicy(owner, org, binder, "Hand Hygiene");
  await approve(reviewer, owner, org, binder, change);

  await addPolicy(owner, org, binder, "Staff Handbook", change);

  // Give Gitea the same moment it takes to dismiss, then check nothing did.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(await approvalCount(owner, org, binder, change)).toBe(1);
});
