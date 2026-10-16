/**
 * Deleting a binder, by Gitea's rule: only an owner of the organization.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";
import { LEGAL_VERSION } from "../packages/utils/legal";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

async function signUp(): Promise<{ username: string; session: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `delbinder-${suffix}`;
  const response = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
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

test("a member cannot delete a binder; an owner can, by typing its name", async ({
  page,
}) => {
  const owner = await signUp();
  const member = await signUp();
  const created = await call(owner.session, "POST", "/api/app/organizations", {
    acceptedTerms: LEGAL_VERSION,
    name: `Delete Binder ${randomUUID().slice(0, 6)}`,
  });
  const org = (await created.json()).organization.name as string;
  const made = await call(
    owner.session,
    "POST",
    `/api/app/orgs/${org}/binders`,
    {
      name: "Old Policies",
    },
  );
  const binder = (await made.json()).workspace.name as string;
  await call(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: member.username,
  });

  // A member is told no by Gitea's rule, and is not offered the control.
  const memberSettings = await (
    await call(
      member.session,
      "GET",
      `/api/app/binders/${org}/${binder}/settings`,
    )
  ).json();
  expect(memberSettings.canDelete).toBe(false);
  const refused = await call(
    member.session,
    "DELETE",
    `/api/app/binders/${org}/${binder}`,
    { confirm: binder },
  );
  expect(refused.status).toBe(403);

  // The owner deletes it from its settings.
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: owner.session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/-/settings`);
  const remove = page.getByRole("button", { name: "Delete this binder" });
  await expect(remove).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(binder);
  await remove.click();

  await expect(page).toHaveURL(`${APP_BASE_URL}/${org}`);
  const gone = await call(
    owner.session,
    "GET",
    `/api/app/binders/${org}/${binder}`,
  );
  expect(gone.status).toBe(404);
});
