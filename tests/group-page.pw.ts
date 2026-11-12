/**
 * Every group has a page (4.8): who is in it, which binders it can use, and
 * where it signs off — read live from each binder's rules.
 *
 * Against the seeded Infection Control group, which signs off on Governance's
 * Clinical Standards folder. Read only.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  APP_BASE_URL,
  OWNER,
  signInAsAlice,
  signInAsBob,
} from "./helpers";
import { signUpAndConfirm } from "./mailpit";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

const GROUP = `${APP_BASE_URL}/${OWNER}/-/groups/infection-control`;

test("a group's page says where it signs off, and links there", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(GROUP);

  await expect(
    page.getByRole("heading", { level: 1, name: "Infection Control" }),
  ).toBeVisible();
  const signs = page.getByRole("region", { name: "Where it signs off" });
  const row = signs.getByRole("link", {
    name: /Governance · Clinical Standards/,
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Hand Hygiene");
  await row.click();
  await expect(page).toHaveURL(
    `${APP_BASE_URL}/${OWNER}/governance/-/tree/main/clinical-standards`,
  );
});

test("an owner can change who is in it", async ({ page }) => {
  await signInAsAlice(page);
  await page.goto(GROUP);
  const people = page.getByRole("region", { name: "People" });
  await expect(
    people.getByRole("button", { name: "Add a person" }),
  ).toBeVisible();
  await expect(
    people
      .getByRole("button", { name: /Take .* out of Infection Control/ })
      .first(),
  ).toBeVisible();
});

test("a member who is not an owner reads it, and changes nothing", async ({
  page,
}) => {
  await signInAsBob(page);
  await page.goto(GROUP);
  const people = page.getByRole("region", { name: "People" });
  await expect(people).toContainText("Grace Ibori");
  await expect(
    people.getByRole("button", { name: "Add a person" }),
  ).toHaveCount(0);
  await expect(
    people.getByRole("button", { name: /Take .* out of/ }),
  ).toHaveCount(0);
});

test("a group name in the sign-off panel opens the group's page", async ({
  page,
}) => {
  await signInAsAlice(page);
  await page.goto(
    `${APP_BASE_URL}/${OWNER}/governance/-/tree/main/clinical-standards`,
  );
  await page
    .getByRole("region", { name: "Who signs off here" })
    .getByRole("link", { name: "Infection Control" })
    .click();
  await expect(page).toHaveURL(GROUP);
  await expect(
    page.getByRole("heading", { level: 1, name: "Infection Control" }),
  ).toBeVisible();
});

test("someone outside the organization is told there is no such group", async () => {
  // The group's people are read with the service account, so membership of
  // the organization is checked first; an outsider learns nothing, not even
  // that the group exists.
  const suffix = randomUUID().slice(0, 10);
  const signup = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: `outsider-${suffix}`,
      email: `outsider-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
      firstName: "Out",
      lastName: "Sider",
    }),
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1];
  const read = await fetch(
    `${API_BASE_URL}/api/app/orgs/${OWNER}/groups/infection-control`,
    {
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
    },
  );
  expect(read.status).toBe(404);
  expect(await read.text()).not.toContain("grace");
});
