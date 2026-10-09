/**
 * Send feedback, from the app to the feedback Worker's door.
 *
 * The Worker and Turnstile are Cloudflare's and are not in this stack, so the
 * test stands in for both: Turnstile with a script that hands out a token, the
 * Worker with a route that records what arrived. `services/feedback` tests
 * the Worker's side; this checks what the app sends — and that the API's
 * request IDs make it into the trace, which needs the real API.
 */
import { expect, test, type Page } from "@playwright/test";

import { signInAsAlice } from "./helpers";

const FEEDBACK_URL = "https://feedback.invalid/";

async function standInForCloudflare(page: Page) {
  const reports: unknown[] = [];

  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile = {
        render: (el, o) => { setTimeout(() => o.callback("pw-token"), 0); return "w1"; },
        reset: () => {},
        remove: () => {},
      };`,
    }),
  );

  await page.route(FEEDBACK_URL, async (route) => {
    const cors = {
      "Access-Control-Allow-Origin": new URL(page.url()).origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    reports.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ received: true }),
    });
  });

  return reports;
}

test("a report carries who, where, and the API's request IDs", async ({
  page,
}) => {
  const reports = await standInForCloudflare(page);
  await signInAsAlice(page);

  // In the sidebar's foot, beside the collapse toggle.
  await page
    .locator(".app-sidebar-foot")
    .getByRole("button", { name: "Send feedback" })
    .click();
  // Named by its heading, which becomes the thanks once it is sent.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Send feedback");

  await dialog.getByLabel("In a few words").fill("The home page is slow");
  await dialog.getByLabel("What happened?").fill("It took a while to load.");

  // What will be sent is on screen before it is.
  await dialog.getByText("What we’ll send with it").click();
  await expect(dialog.locator(".feedback-dialog-json")).toContainText(
    '"username": "alice"',
  );

  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog.getByText("Thanks — it’s with us.")).toBeVisible();

  expect(reports).toHaveLength(1);
  const report = reports[0] as {
    kind: string;
    title: string;
    turnstileToken: string;
    trace: {
      user: { username: string } | null;
      apiCalls: { path: string; status: number; requestId?: string }[];
      app: { version: string };
    };
  };
  expect(report).toMatchObject({
    kind: "bug",
    title: "The home page is slow",
    turnstileToken: "pw-token",
  });
  expect(report.trace.user?.username).toBe("alice");

  // The API stamped every call, and the app could read the stamp across
  // origins: a report points straight at the server's log lines.
  const answered = report.trace.apiCalls.filter((call) => call.status > 0);
  expect(answered.length).toBeGreaterThan(0);
  for (const call of answered) {
    expect(call.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.path).not.toContain("?");
  }

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("on a phone it is in the account menu", async ({ page }) => {
  await standInForCloudflare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsAlice(page);

  await expect(
    page.getByRole("button", { name: "Send feedback" }),
  ).toBeHidden();
  await page.locator(".app-topnav-avatar").click();
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  await expect(
    page.getByRole("dialog", { name: "Send feedback" }),
  ).toBeVisible();
});
