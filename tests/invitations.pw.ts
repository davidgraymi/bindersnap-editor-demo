/**
 * Inviting somebody into an organization by email (issue 426), end to end:
 * the invitation, the email, signing up from the link, and the rules that make
 * the link safe — bound to the address, nothing granted until accepted, and
 * the join made with an owner's own token.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL, agreeToTerms } from "./helpers";
import { countEmails, signUpAndConfirm, waitForEmail } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 180_000 });

interface Person {
  username: string;
  email: string;
  password: string;
  session: string;
}

async function signUp(prefix: string, email?: string): Promise<Person> {
  const suffix = randomUUID().slice(0, 12);
  const username = `${prefix}-${suffix}`;
  const address = email ?? `${username}@users.bindersnap.local`;
  const password = `Bindersnap-${suffix}!`;
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Olivia",
      lastName: "Owens",
      username,
      email: address,
      password,
    }),
  });
  expect(response.status).toBe(200);
  return { username, email: address, password, session: sessionOf(response) };
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
): Promise<{ status: number; body: Record<string, unknown> }> {
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
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}

async function ok(
  session: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const result = await call(session, method, path, body);
  expect(
    result.status,
    `${method} ${path}: ${JSON.stringify(result.body)}`,
  ).toBeLessThan(300);
  return result.body;
}

async function orgWithBinder(owner: Person) {
  const created = await ok(owner.session, "POST", "/api/app/organizations", {
    name: `Invite ${randomUUID().slice(0, 6)}`,
  });
  const org = (created.organization as { name: string }).name;
  const binder = (
    (
      await ok(owner.session, "POST", `/api/app/orgs/${org}/binders`, {
        name: "Policies",
      })
    ).workspace as { name: string }
  ).name;
  return { org, binder };
}

async function members(owner: Person, org: string): Promise<string[]> {
  const people = await ok(owner.session, "GET", `/api/app/orgs/${org}/people`);
  return (people.people as { login: string }[]).map((p) => p.login);
}

function tokenOf(link: string): string {
  return new URL(link).pathname.split("/").pop()!;
}

test("somebody with no account signs up from the email and lands in the binder", async ({
  page,
}) => {
  const owner = await signUp("owner");
  const { org, binder } = await orgWithBinder(owner);
  const address = `new-${randomUUID().slice(0, 10)}@users.bindersnap.local`;

  const invited = await ok(
    owner.session,
    "POST",
    `/api/app/orgs/${org}/invitations`,
    {
      email: address,
      binder,
      level: "reviewer",
    },
  );
  expect((invited.invitation as { grant: string }).grant).toBe(
    `a reviewer in ${binder}`,
  );
  // Nothing granted yet.
  expect(await members(owner, org)).not.toContain(address);

  const email = await waitForEmail(address, /invited you to .* on Bindersnap$/);
  const link = email.links.find((href) => href.includes("/-/invitations/"))!;
  expect(link.startsWith(`${APP_BASE_URL}/-/invitations/`)).toBe(true);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: /^Join / })).toBeVisible();
  await page.getByRole("button", { name: "Create your account" }).click();
  await expect(page).toHaveURL(/\/-\/signup/);
  await expect(page.getByLabel("Email")).toHaveValue(address);

  const username = `invitee-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("First name").fill("Priya");
  await page.getByLabel("Last name").fill("Raman");
  await page.getByLabel("Username").fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Bindersnap-invitee-1!");
  await page.getByLabel("Confirm Password").fill("Bindersnap-invitee-1!");
  await agreeToTerms(page);
  await page.getByRole("button", { name: "Create account" }).click();

  // Back at the invitation, now signed in. The invitation went to this
  // address, which proves it: no confirmation email, no waiting.
  await expect(page).toHaveURL(/\/-\/invitations\//);
  await page.getByRole("button", { name: /^Join / }).click();
  await expect(page).toHaveURL(new RegExp(`/${org}$`));
  expect(await countEmails(address)).toBe(1);

  expect(await members(owner, org)).toContain(username);
  const binderPeople = await ok(
    owner.session,
    "GET",
    `/api/app/binders/${org}/${binder}/people`,
  );
  expect(JSON.stringify(binderPeople)).toContain(username);

  // Done: off the pending list, and the link will not work twice.
  const pending = await ok(
    owner.session,
    "GET",
    `/api/app/orgs/${org}/invitations`,
  );
  expect(pending.invitations).toEqual([]);
  const again = await signUp("other");
  expect(
    (
      await call(
        again.session,
        "POST",
        `/api/app/invitations/${tokenOf(link)}/accept`,
      )
    ).status,
  ).toBe(409);
});

test("a forwarded link does not work for a different address, and a revoked one not at all", async () => {
  const owner = await signUp("owner");
  const { org } = await orgWithBinder(owner);
  const address = `invited-${randomUUID().slice(0, 10)}@users.bindersnap.local`;
  await ok(owner.session, "POST", `/api/app/orgs/${org}/invitations`, {
    email: address,
  });
  const link = (await waitForEmail(address, /invited you to/)).links.find(
    (href) => href.includes("/-/invitations/"),
  )!;
  const token = tokenOf(link);

  const stranger = await signUp("stranger");
  const refused = await call(
    stranger.session,
    "POST",
    `/api/app/invitations/${token}/accept`,
  );
  expect(refused.status).toBe(403);
  expect(String(refused.body.error)).toContain("This invitation is for");
  expect(await members(owner, org)).not.toContain(stranger.username);

  // Somebody outside the organization cannot see its invitations — or that
  // it exists: 404, as for any organization a session cannot see.
  expect(
    (await call(stranger.session, "GET", `/api/app/orgs/${org}/invitations`))
      .status,
  ).toBe(404);

  const pending = await ok(
    owner.session,
    "GET",
    `/api/app/orgs/${org}/invitations`,
  );
  const id = (pending.invitations as { id: string }[])[0]!.id;
  await ok(owner.session, "DELETE", `/api/app/orgs/${org}/invitations/${id}`);

  const invitee = await signUp("invitee", address);
  expect(
    (
      await call(
        invitee.session,
        "POST",
        `/api/app/invitations/${token}/accept`,
      )
    ).status,
  ).toBe(410);
});

test("accepted with no owner signed in, it waits, and finishes when one signs in", async () => {
  const owner = await signUp("owner");
  const { org } = await orgWithBinder(owner);
  const address = `waiting-${randomUUID().slice(0, 10)}@users.bindersnap.local`;
  await ok(owner.session, "POST", `/api/app/orgs/${org}/invitations`, {
    email: address,
  });
  const link = (await waitForEmail(address, /invited you to/)).links.find(
    (href) => href.includes("/-/invitations/"),
  )!;

  // The only owner signs out: nobody can add anybody to this organization.
  await ok(owner.session, "POST", "/auth/logout");

  const invitee = await signUp("invitee", address);
  const accepted = await ok(
    invitee.session,
    "POST",
    `/api/app/invitations/${tokenOf(link)}/accept`,
  );
  expect(accepted.status).toBe("accepted");

  // The owner comes back; signing in finishes it.
  const login = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: owner.username,
      password: owner.password,
    }),
  });
  expect(login.status).toBe(200);
  const back = { ...owner, session: sessionOf(login) };
  await expect
    .poll(() => members(back, org), { timeout: 30_000 })
    .toContain(invitee.username);
});

test("a member who is not an owner cannot invite", async () => {
  const owner = await signUp("owner");
  const { org } = await orgWithBinder(owner);
  const member = await signUp("member");
  await ok(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: member.username,
  });
  const refused = await call(
    member.session,
    "GET",
    `/api/app/orgs/${org}/invitations`,
  );
  expect(refused.status).toBe(403);
  expect(String(refused.body.error)).toContain("Only an owner");
});

test("an owner invites from the People page, sees it pending, and can revoke it", async ({
  page,
}) => {
  const owner = await signUp("owner");
  const { org, binder } = await orgWithBinder(owner);
  const address = `ui-${randomUUID().slice(0, 10)}@users.bindersnap.local`;

  await page.goto(`${APP_BASE_URL}/-/login`);
  await page.getByLabel("Username or Email").fill(owner.username);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto(`${APP_BASE_URL}/${org}/-/people`);

  const invite = page.getByRole("region", { name: "Invite by email" });
  await invite
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(address);
  await invite
    .getByRole("combobox", { name: "Binder", exact: true })
    .selectOption(binder);
  await invite
    .getByRole("combobox", { name: "As", exact: true })
    .selectOption("reviewer");
  await invite.getByRole("button", { name: "Send invitation" }).click();
  await expect(invite.getByRole("status")).toHaveText(
    `Invitation sent to ${address}.`,
  );

  const pending = invite.getByRole("region", { name: "Pending invitations" });
  await expect(pending.getByText(address)).toBeVisible();
  await expect(
    pending.getByText(`A reviewer in ${binder} · sent today`),
  ).toBeVisible();
  await waitForEmail(address, /invited you to/);

  await pending.getByRole("button", { name: "Revoke" }).click();
  await expect(invite.getByRole("status")).toHaveText(
    `The invitation to ${address} no longer works.`,
  );
  await expect(pending).toHaveCount(0);
});
