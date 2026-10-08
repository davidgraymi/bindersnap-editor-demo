/**
 * The bell: Gitea's own notifications, each with the reason it is yours.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

function headers(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(): Promise<{ session: string; username: string }> {
  const suffix = randomUUID().slice(0, 12);
  const username = `notify-${suffix}`;
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
  return { session, username };
}

async function call(
  session: string,
  method: string,
  path: string,
  body?: unknown,
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: headers(session),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path}: ${text}`).toBeLessThan(300);
  return text ? JSON.parse(text) : {};
}

test("a colleague asked to review sees it on the bell, and opening it clears it", async ({
  page,
}) => {
  const owner = await signUp();
  const colleague = await signUp();
  const { organization } = await call(
    owner.session,
    "POST",
    "/api/app/organizations",
    {
      name: `Notify ${randomUUID().slice(0, 6)}`,
    },
  );
  const org = organization.name as string;
  const { workspace } = await call(
    owner.session,
    "POST",
    `/api/app/orgs/${org}/binders`,
    {
      name: "Policies",
    },
  );
  const binder = workspace.name as string;
  await call(owner.session, "POST", `/api/app/orgs/${org}/people`, {
    username: colleague.username,
    owner: false,
  });

  const form = new FormData();
  form.set(
    "file",
    new Blob(["# Fire safety\n"], { type: "text/markdown" }),
    "fire.md",
  );
  form.set("name", "Fire Safety");
  const added = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    {
      method: "POST",
      headers: {
        Cookie: `bindersnap_session=${owner.session}`,
        Origin: APP_BASE_URL,
      },
      body: form,
    },
  );
  const { pullRequestNumber } = (await added.json()) as {
    pullRequestNumber: number;
  };
  await call(
    owner.session,
    "PUT",
    `/api/app/binders/${org}/${binder}/changes/${pullRequestNumber}/assignments`,
    { reviewers: [colleague.username] },
  );

  // Gitea writes the notification; the bell says why it is theirs.
  await expect
    .poll(
      async () => {
        const { notifications } = await call(
          colleague.session,
          "GET",
          "/api/app/notifications",
        );
        return (
          notifications as {
            changeNumber: number;
            binder: string;
            reason: string;
          }[]
        ).find(
          (note) =>
            note.binder === binder && note.changeNumber === pullRequestNumber,
        )?.reason;
      },
      { timeout: 30_000 },
    )
    .toBe("review_requested");

  await page.context().addCookies([
    {
      name: "bindersnap_session",
      value: colleague.session,
      url: APP_BASE_URL,
    },
  ]);
  await page.goto(`${APP_BASE_URL}/`);
  const bell = page.locator(".notif-bell");
  await expect(bell).toHaveAttribute("aria-label", /unread/, {
    timeout: 30_000,
  });
  await bell.click();
  const row = page
    .locator(".notif-row", { hasText: "asked for your review" })
    .first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(`/${binder}/-/changes/${pullRequestNumber}`),
  );

  // Read now: the thread is no longer among the unread.
  await expect
    .poll(async () => {
      const { notifications } = await call(
        colleague.session,
        "GET",
        "/api/app/notifications",
      );
      return (notifications as { changeNumber: number; binder: string }[]).some(
        (note) =>
          note.binder === binder && note.changeNumber === pullRequestNumber,
      );
    })
    .toBe(false);
});
