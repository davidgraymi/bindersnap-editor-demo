/**
 * Who may change what a change request proposes: its author and the
 * co-editors they name, and nobody else.
 *
 * The seed's Clinical change "Tighten hand hygiene auditing and new-hire
 * training" is Alice's, with Grace as its co-editor.
 */
import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  APP_BASE_URL,
  GITEA_BOB_PASS,
  GITEA_BOB_USER,
  OWNER,
  signInAsAlice,
  signInAsBob,
} from "./helpers";

const BINDER = `${OWNER}/clinical`;
const TITLE = "Tighten hand hygiene auditing and new-hire training";

async function openTheChange(page: import("@playwright/test").Page) {
  await page.goto(`${APP_BASE_URL}/${BINDER}/-/changes`);
  await page.getByRole("link", { name: TITLE }).first().click();
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible({
    timeout: 30_000,
  });
  return Number(page.url().match(/\/changes\/(\d+)/)?.[1]);
}

test("the author names co-editors, and only they can take one off", async ({
  page,
}) => {
  await signInAsAlice(page);
  await openTheChange(page);

  const about = page.locator(".change-coeditors");
  await expect(about).toContainText("Grace");

  await about.getByRole("button", { name: "Co-editor" }).click();
  const pick = about.getByLabel("Let somebody else edit this change");
  await expect(pick.locator("option").nth(1)).toBeAttached({
    timeout: 30_000,
  });
  const chosen = (await pick.locator("option").nth(1).textContent())!.trim();
  await pick.selectOption({ index: 1 });

  const remove = about.getByRole("button", {
    name: `Stop ${chosen} editing this change`,
  });
  await expect(remove).toBeVisible({ timeout: 30_000 });
  await remove.click();
  await expect(remove).toHaveCount(0, { timeout: 30_000 });
  await expect(about).toContainText("Grace");
});

test("somebody who is neither the author nor a co-editor reads, and cannot edit", async ({
  page,
}) => {
  await signInAsBob(page);
  const number = await openTheChange(page);

  // Bob sees who can edit it, and cannot change the list.
  const about = page.locator(".change-coeditors");
  await expect(about).toContainText("Grace");
  await expect(about.getByRole("button", { name: "Co-editor" })).toHaveCount(0);

  // The Changes tab offers him no way into the editor.
  await page.goto(`${APP_BASE_URL}/${BINDER}/-/changes/${number}/diffs`);
  await expect(page.locator(".cmp-file").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: /^Edit/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit/ })).toHaveCount(0);

  // And the API refuses him too, whatever the page offers.
  const login = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      identifier: GITEA_BOB_USER,
      password: GITEA_BOB_PASS,
    }),
  });
  const session = (login.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )?.[1];
  expect(session).toBeTruthy();
  const named = await fetch(
    `${API_BASE_URL}/api/app/binders/${BINDER}/changes/${number}/assignments`,
    {
      method: "PUT",
      headers: {
        Cookie: `bindersnap_session=${session}`,
        "Content-Type": "application/json",
        Origin: APP_BASE_URL,
      },
      body: JSON.stringify({ coEditors: [GITEA_BOB_USER] }),
    },
  );
  expect(named.status).toBe(403);
});
