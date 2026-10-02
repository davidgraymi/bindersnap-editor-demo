/**
 * The signed-in person's own account, at `/-/user_settings/profile`.
 *
 * A name is what the record writes, so it is asked for at signup and can be
 * changed here — and the account menu says it, with the login beneath.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<{
  username: string;
  password: string;
  session: string;
}> {
  const suffix = randomUUID().slice(0, 12);
  const username = `account-${suffix}`;
  const password = `Bindersnap-${suffix}!`;
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Jordan",
      lastName: "Kim",
      username,
      email: `${username}@users.bindersnap.local`,
      password,
    }),
  });
  expect(response.status).toBe(200);
  return { username, password, session: sessionOf(response) };
}

function sessionOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
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

async function signIn(identifier: string, password: string): Promise<number> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ identifier, password }),
  });
  return response.status;
}

/** An organization with one binder in it, owned by this session. */
async function organizationWithBinder(
  session: string,
): Promise<{ org: string; binder: string }> {
  const created = await call(session, "POST", "/api/app/organizations", {
    name: `Account Org ${randomUUID().slice(0, 8)}`,
  });
  expect(created.status).toBe(201);
  const org = (await created.json()).organization.name as string;
  const binder = await call(session, "POST", `/api/app/orgs/${org}/binders`, {
    name: "Policies",
  });
  expect(binder.status, await binder.clone().text()).toBeLessThan(300);
  return { org, binder: "policies" };
}

test("signup refuses an account with no name", async () => {
  const suffix = randomUUID().slice(0, 12);
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: `noname-${suffix}`,
      email: `noname-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Enter your first and last name.");
});

test("a name given at signup is the name the app uses, and can be changed", async ({
  page,
}) => {
  const { username, session } = await signUp();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);

  await page.goto(`${APP_BASE_URL}/`);
  await page.getByRole("button", { name: `User: ${username}` }).click();
  const menu = page.getByRole("menu", { name: "Account menu" });
  await expect(menu.getByText("Jordan Kim")).toBeVisible();
  await expect(menu.getByText(`@${username}`)).toBeVisible();

  await menu.getByRole("menuitem", { name: "Your account" }).click();
  await expect(page).toHaveURL(/\/-\/user_settings\/profile$/);
  await expect(page.getByLabel("First name")).toHaveValue("Jordan");
  await expect(page.getByLabel("Last name")).toHaveValue("Kim");

  await page.getByLabel("First name").fill("Jordana");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  // Everywhere that names them catches up without a reload.
  await page.getByRole("button", { name: `User: ${username}` }).click();
  await expect(menu.getByText("Jordana Kim")).toBeVisible();
});

test("a new password needs the current one, and signs out every other device", async ({
  page,
}) => {
  const { username, password, session } = await signUp();
  // A second device, signed in before the change.
  const elsewhere = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ identifier: username, password }),
  });
  const otherSession = sessionOf(elsewhere);

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/-/user_settings/profile`);

  const newPassword = `${password}-new`;
  await page.getByLabel("Current password").first().fill("not-it");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("New password again").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That is not your current password.",
  );

  await page.getByLabel("Current password").first().fill(password);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByText("Password changed. Every other device"),
  ).toBeVisible();

  expect(await signIn(username, password)).toBe(401);
  expect(await signIn(username, newPassword)).toBe(200);
  // This device stays signed in; the other one does not.
  expect((await call(session, "GET", "/auth/me")).status).toBe(200);
  expect((await call(otherSession, "GET", "/auth/me")).status).toBe(401);
});

test("a new username keeps the session, and the person's drafts follow it", async () => {
  const { username, password, session } = await signUp();
  const { org, binder } = await organizationWithBinder(session);

  const opened = await call(
    session,
    "POST",
    `/api/app/binders/${org}/${binder}/draft`,
    { name: "Annual review" },
  );
  expect(opened.status, await opened.clone().text()).toBeLessThan(300);

  const renamedTo = `${username}-r`;
  const wrong = await call(session, "POST", "/api/app/account/username", {
    newUsername: renamedTo,
    password: "not-it",
  });
  expect(wrong.status).toBe(403);

  const renamed = await call(session, "POST", "/api/app/account/username", {
    newUsername: renamedTo,
    password,
  });
  expect(renamed.status, await renamed.clone().text()).toBe(200);
  expect((await renamed.json()).user.username).toBe(renamedTo);

  // Same session, new name.
  const me = await (await call(session, "GET", "/auth/me")).json();
  expect(me.user.username).toBe(renamedTo);
  expect(me.user.fullName).toBe("Jordan Kim");

  // The draft is theirs under the new name, with the name they gave it.
  const drafts = await (
    await call(session, "GET", `/api/app/binders/${org}/${binder}/draft`)
  ).json();
  expect(
    drafts.drafts.map((draft: { branch: string; name: string }) => [
      draft.branch.split("/")[1],
      draft.name,
    ]),
  ).toEqual([[renamedTo, "Annual review"]]);

  expect(await signIn(renamedTo, password)).toBe(200);
});

test("the only owner cannot delete their account; a member can", async ({
  page,
}) => {
  const owner = await signUp();
  const { org } = await organizationWithBinder(owner.session);

  const refused = await call(owner.session, "DELETE", "/api/app/account", {
    password: owner.password,
    confirm: owner.username,
  });
  expect(refused.status).toBe(409);
  expect((await refused.json()).organizations).toEqual([org]);

  // And the page says so before anybody types a password.
  const ownerPage = await page.context().browser()!.newPage();
  await ownerPage
    .context()
    .addCookies([
      { name: "bindersnap_session", value: owner.session, url: APP_BASE_URL },
    ]);
  await ownerPage.goto(`${APP_BASE_URL}/-/user_settings/profile`);
  await expect(
    ownerPage.getByText("You are the only owner of these organizations."),
  ).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: org })).toBeVisible();
  await ownerPage.getByLabel(/to confirm/).fill(owner.username);
  await ownerPage.getByLabel("Current password").last().fill(owner.password);
  await expect(
    ownerPage.getByRole("button", { name: "Delete my account" }),
  ).toBeDisabled();
  await ownerPage.close();

  const member = await signUp();
  const added = await call(
    owner.session,
    "POST",
    `/api/app/orgs/${org}/people`,
    {
      username: member.username,
    },
  );
  expect(added.status, await added.clone().text()).toBeLessThan(300);

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: member.session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/-/user_settings/profile`);
  const remove = page.getByRole("button", { name: "Delete my account" });
  await expect(remove).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(member.username);
  await page.getByLabel("Current password").last().fill(member.password);
  await remove.click();

  // Signed out, and gone.
  await expect(page).toHaveURL(`${APP_BASE_URL}/`);
  expect(await signIn(member.username, member.password)).toBe(401);
  const people = await (
    await call(owner.session, "GET", `/api/app/orgs/${org}/people`)
  ).text();
  expect(people).not.toContain(member.username);
});
