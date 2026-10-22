/**
 * An error nothing caught, from the app to the feedback Worker's `/errors`.
 *
 * The Worker is Cloudflare's and not in this stack, so a route stands in for
 * it and records what arrived. `services/feedback` tests the Worker's side;
 * this checks what the real app sends, and what it never does.
 */
import { expect, test, type Page } from "@playwright/test";

import { signInAsAlice } from "./helpers";

const ERRORS_URL = "https://feedback.invalid/errors";

async function standInForTheWorker(page: Page) {
  const reports: Record<string, unknown>[] = [];
  await page.route(ERRORS_URL, async (route) => {
    reports.push(route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      headers: { "Access-Control-Allow-Origin": new URL(page.url()).origin },
      contentType: "application/json",
      body: JSON.stringify({ received: true }),
    });
  });
  return reports;
}

test("an uncaught error is reported once, without who or where", async ({
  page,
}) => {
  const reports = await standInForTheWorker(page);
  await signInAsAlice(page);
  await page.goto("/riverside-health/clinical");
  await expect(page.locator(".app-main-area")).toBeVisible();

  const throwIt = () =>
    page.evaluate(() => {
      setTimeout(() => {
        throw new TypeError("pw: cannot read 'title' for alice@example.com");
      });
    });
  await throwIt();
  await throwIt();

  // Only ours: anything else the page logs is not this test's business.
  const ours = () =>
    reports.filter((report) => String(report.message).startsWith("pw:"));
  await expect.poll(() => ours().length).toBe(1);
  // A moment for a second one, which should never come.
  await page.waitForTimeout(500);
  expect(ours()).toHaveLength(1);

  const [report] = ours();
  expect(report).toMatchObject({
    source: "app",
    kind: "TypeError",
    message: "pw: cannot read 'title' for [email]",
    where: "binder",
  });
  const sent = JSON.stringify(report);
  expect(sent).not.toContain("riverside");
  expect(sent).not.toContain("alice");
});

test("a failed API call is the API's to report, not the app's", async ({
  page,
}) => {
  const reports = await standInForTheWorker(page);
  await signInAsAlice(page);
  await page.evaluate(() => {
    void Promise.reject(
      Object.assign(new Error("Internal"), {
        name: "ApiRequestError",
      }),
    );
  });
  await page.waitForTimeout(500);
  expect(reports.filter((report) => report.message === "Internal")).toEqual([]);
});
