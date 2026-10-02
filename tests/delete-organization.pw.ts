/**
 * Deleting an organization, by Gitea's rules: an owner, once no binder is left
 * in it.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<{ username: string; session: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `delorg-${suffix}`;
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

async function call(
  session: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("an organization goes only once its binders have, and only by an owner", async ({
  page,
}) => {
  const owner = await signUp();
  const member = await signUp();
  const created = await call(owner.session, "POST", "/api/app/organizations", {
    name: `Delete Org ${randomUUID().slice(0, 6)}`,
  });
  const org = (await created.json()).organization.name as string;
  const binder = (
    await (
      await call(owner.session, "POST", `/api/app/orgs/${org}/binders`, {
        name: "Policies",
      })
    ).json()
  ).workspace.name as string;
  await call(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: member.username,
  });

  // A binder in it: refused, and named.
  const blocked = await call(owner.session, "DELETE", `/api/app/orgs/${org}`, {
    confirm: org,
  });
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).binders).toEqual([binder]);

  // The page says the same before anybody types anything.
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: owner.session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/-/settings`);
  await expect(page.getByRole("link", { name: binder })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete this organization" }),
  ).toHaveCount(0);

  const deleted = await call(
    owner.session,
    "DELETE",
    `/api/app/binders/${org}/${binder}`,
    { confirm: binder },
  );
  expect(deleted.status).toBe(204);

  // A member may not, whatever is left in it.
  const refused = await call(member.session, "DELETE", `/api/app/orgs/${org}`, {
    confirm: org,
  });
  expect(refused.status).toBe(403);

  await page.reload();
  const remove = page.getByRole("button", { name: "Delete this organization" });
  await expect(remove).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(org);
  await remove.click();
  await expect(page).toHaveURL(`${APP_BASE_URL}/`);

  const organizations = await (
    await call(owner.session, "GET", "/api/app/organizations")
  ).json();
  expect(
    organizations.organizations.map((entry: { name: string }) => entry.name),
  ).not.toContain(org);
});
