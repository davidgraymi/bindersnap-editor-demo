/**
 * An organization's General settings: its name, its description, and what a
 * new binder in it starts with.
 *
 * The name is Gitea's own full name for the organization, and every page
 * shows it; the address in its links stays. The defaults are configuration,
 * written onto a binder when it is made, after which they are the binder's.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";
import { LEGAL_VERSION } from "../packages/utils/legal";

test.describe.configure({ mode: "parallel", timeout: 180_000 });

function headers(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(): Promise<{ session: string; username: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `orgset-${suffix}`;
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "Owner",
      username,
      email: `${username}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const session = /bindersnap_session=([^;]+)/.exec(
    response.headers.get("set-cookie") ?? "",
  )?.[1];
  expect(session).toBeTruthy();
  return { session: session!, username };
}

async function createOrganization(session: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({
      acceptedTerms: LEGAL_VERSION,
      name: `Lakeside ${randomUUID().slice(0, 6)}`,
    }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(201);
  return (JSON.parse(body) as { organization: { name: string } }).organization
    .name;
}

async function createBinder(
  session: string,
  org: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ name, ...extra }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

async function binderRules(session: string, org: string, binder: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/settings`,
    { headers: headers(session) },
  );
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      rules: {
        requiredApprovals: number | null;
        dismissStaleApprovals: boolean;
        blockOnUnresolvedThreads: boolean;
      };
    }
  ).rules;
}

test("an owner renames the organization and says what it is for", async ({
  page,
}) => {
  const { session } = await signUp();
  const org = await createOrganization(session);
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/-/settings`);

  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toBeVisible({ timeout: 30_000 });
  // The address is said, and stays.
  await expect(page.locator("#org-settings-name-hint")).toContainText(
    `/${org}`,
  );

  await name.fill("Lakeside Community Care");
  await page
    .getByLabel(/^Description/)
    .fill("Home health and hospice across the lake district.");
  await page.getByRole("button", { name: "Save" }).click();

  // Every page that names it now says the new name, at the same address.
  await expect(page.locator(".app-sidebar-scope-name")).toHaveText(
    "Lakeside Community Care",
    { timeout: 30_000 },
  );
  expect(new URL(page.url()).pathname).toBe(`/${org}/-/settings`);

  const settings = (await (
    await fetch(`${API_BASE_URL}/api/app/orgs/${org}/settings`, {
      headers: headers(session),
    })
  ).json()) as {
    organization: { displayName: string; description: string; name: string };
  };
  expect(settings.organization).toMatchObject({
    name: org,
    displayName: "Lakeside Community Care",
    description: "Home health and hospice across the lake district.",
  });
});

test("a new binder starts with the organization's defaults", async () => {
  const { session } = await signUp();
  const org = await createOrganization(session);

  // Before anybody chooses, a binder starts as the product starts one.
  const plain = await createBinder(session, org, "Plain");
  expect(await binderRules(session, org, plain)).toMatchObject({
    requiredApprovals: 0,
    dismissStaleApprovals: true,
    blockOnUnresolvedThreads: false,
  });

  const changed = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/settings`, {
    method: "PATCH",
    headers: headers(session),
    body: JSON.stringify({
      newBinders: {
        requiredApprovals: 2,
        dismissStaleApprovals: false,
        blockOnUnresolvedThreads: true,
      },
    }),
  });
  expect(changed.status, await changed.clone().text()).toBe(200);

  // A binder made now starts with them...
  const governed = await createBinder(session, org, "Governed");
  expect(await binderRules(session, org, governed)).toMatchObject({
    requiredApprovals: 2,
    dismissStaleApprovals: false,
    blockOnUnresolvedThreads: true,
  });
  // ...unless the form asked for a count of its own...
  const asked = await createBinder(session, org, "Asked", {
    requiredApprovals: 1,
  });
  expect((await binderRules(session, org, asked)).requiredApprovals).toBe(1);
  // ...and the binder made before is untouched.
  expect((await binderRules(session, org, plain)).requiredApprovals).toBe(0);

  // Who approves is each binder's, never a default.
  const refused = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/settings`, {
    method: "PATCH",
    headers: headers(session),
    body: JSON.stringify({ newBinders: { approvers: { groups: ["Owners"] } } }),
  });
  expect(refused.status).toBe(400);
});

test("only an owner changes them", async () => {
  const owner = await signUp();
  const org = await createOrganization(owner.session);
  const member = await signUp();
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: headers(owner.session),
    body: JSON.stringify({ username: member.username, owner: false }),
  });
  expect(added.status, await added.clone().text()).toBeLessThan(300);

  const read = (await (
    await fetch(`${API_BASE_URL}/api/app/orgs/${org}/settings`, {
      headers: headers(member.session),
    })
  ).json()) as { canManage: boolean };
  expect(read.canManage).toBe(false);

  const refused = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/settings`, {
    method: "PATCH",
    headers: headers(member.session),
    body: JSON.stringify({ displayName: "Taken over" }),
  });
  expect(refused.status).toBe(403);
});
