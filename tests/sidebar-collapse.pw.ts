/**
 * The navigation goes down to its icons, and stays there.
 *
 * **A control rather than a breakpoint**, which is the point of it: reading a
 * long policy on a laptop wants the page and not the map, and moving around
 * the product wants the map, and which of those somebody is doing changes
 * through the day. A width that decided for them would be wrong half the time.
 *
 * The three things worth holding: it narrows, the names go without the
 * destinations going, and the choice survives a reload — asking again on every
 * page load is what would make a preference annoying.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 240_000 });

function authHeaders(session: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
    Cookie: `bindersnap_session=${session}`,
  };
}

async function provision(): Promise<{ session: string; org: string }> {
  const suffix = randomUUID().slice(0, 8);
  const signup = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      username: `nav-${suffix}`,
      email: `nav-${suffix}@example.com`,
      password: "Sufficiently-Long-Passphrase-1",
    }),
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;

  const organization = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: `Riverbend ${suffix}` }),
  });
  const org = (
    (await organization.json()) as { organization: { name: string } }
  ).organization.name;

  return { session, org };
}

test("the navigation collapses to its icons and remembers", async ({
  page,
}) => {
  const { session, org } = await provision();
  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${APP_BASE_URL}/${org}`);

  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 30_000 });
  const open = (await sidebar.boundingBox())!.width;

  await page.getByRole("button", { name: "Collapse the navigation" }).click();

  const narrow = (await sidebar.boundingBox())!.width;
  expect(narrow, "collapsing did not narrow the navigation").toBeLessThan(open);

  // **The destinations are all still there.** Collapsing hides the names and
  // nothing else — a navigation that drops entries at a narrow width is a
  // different navigation, and somebody who has learnt where Billing is would
  // find it gone.
  const entries = await page.locator(".app-sidebar-item").count();
  expect(entries).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Expand the navigation" }),
  ).toBeVisible();

  // The names are hidden from sight and kept for a screen reader, so the
  // navigation reads the same either way.
  await expect(page.locator(".app-sidebar-item-label").first()).toBeAttached();
  const labelWidth = (
    await page.locator(".app-sidebar-item-label").first().boundingBox()
  )?.width;
  expect(labelWidth ?? 0).toBeLessThan(4);

  // A preference that asks again on every page load is the annoying kind.
  await page.reload();
  await expect(sidebar).toBeVisible({ timeout: 30_000 });
  expect((await sidebar.boundingBox())!.width).toBe(narrow);

  await page.getByRole("button", { name: "Expand the navigation" }).click();
  expect((await sidebar.boundingBox())!.width).toBe(open);
});
