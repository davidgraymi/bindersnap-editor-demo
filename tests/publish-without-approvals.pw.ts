/**
 * A binder that needs no approvals publishes a change nobody was asked to
 * review — which is what Gitea does with the same rules. The change page used
 * to wait for an approval anyway, so the author of such a change had no
 * Publish button and no way to get one.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ timeout: 120_000 });

async function call(
  session: string,
  method: string,
  path: string,
  body: unknown,
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  return JSON.parse(text);
}

async function signUpWithBinder(prefix: string) {
  const username = `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const signup = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      username,
      email: `${username}@users.bindersnap.local`,
      password: `Bindersnap-${randomUUID()}!`,
    }),
  });
  expect(signup.status).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  const { organization } = await call(
    session,
    "POST",
    "/api/app/organizations",
    { name: `No Approvals ${randomUUID().slice(0, 6)}` },
  );
  const org = organization.name as string;
  const { workspace } = await call(
    session,
    "POST",
    `/api/app/orgs/${org}/binders`,
    { name: "Policies" },
  );
  return { session, org, binder: workspace.name as string };
}

async function addDocument(session: string, org: string, binder: string) {
  const form = new FormData();
  form.set(
    "file",
    new Blob(
      [
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Wash hands." }],
            },
          ],
        }),
      ],
      { type: "application/json" },
    ),
    "document.json",
  );
  form.set("name", "Hand Hygiene");
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
  expect(added.status).toBe(201);
  return ((await added.json()) as { pullRequestNumber: number })
    .pullRequestNumber;
}

test("a change with no reviewers publishes in a binder that needs no approvals", async ({
  page,
}) => {
  const { session, org, binder } = await signUpWithBinder("noappr");
  await call(session, "PATCH", `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 0,
  });
  const change = await addDocument(session, org, binder);

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/-/changes/${change}`);

  await expect(page.getByText("Ready to publish").first()).toBeVisible();
  await expect(
    page.getByText(
      "You submitted this change — it is waiting on its reviewers.",
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  // Published, it leaves the open list for the closed one.
  await expect(page).toHaveURL(new RegExp(`/${binder}/-/changes(?:[?#]|$)`));
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(page.getByText("Add Hand Hygiene")).toBeVisible();

  // Its own page says how it ended, not that it is still waiting.
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/-/changes/${change}`);
  const approvals = page.locator(".rev-approvals");
  await expect(approvals).toHaveText("Published");
  await expect(
    page.getByText("Nobody was asked to review this."),
  ).toBeVisible();
  await expect(page.getByText("Awaiting review")).toHaveCount(0);
});

test("a binder that needs an approval still waits for one", async ({
  page,
}) => {
  const { session, org, binder } = await signUpWithBinder("oneappr");
  await call(session, "PATCH", `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 1,
  });
  const change = await addDocument(session, org, binder);

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/-/changes/${change}`);

  await expect(page.getByText("0 of 1 approvals").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toHaveCount(0);
});
