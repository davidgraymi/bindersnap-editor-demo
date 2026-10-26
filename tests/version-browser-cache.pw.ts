/**
 * A published version is read once, then kept by the browser (#397).
 *
 * A past version is read at the commit its tag names, which cannot change, so
 * the API marks the bytes immutable and the browser never asks again. A tag or
 * a branch can move, so those stay `no-store`.
 */
import { expect, test } from "@playwright/test";

import {
  API_BASE_URL,
  APP_BASE_URL,
  GITEA_ADMIN_PASS,
  GITEA_ADMIN_USER,
  signInAsAlice,
} from "./helpers";

// Seeded with five published versions (tests/seed-data/dev.yaml).
const DOCUMENT =
  "/riverside-health/clinical/-/blob/main/training/hipaa-training-policy";
const COMMIT_REF = /[?&]ref=[0-9a-f]{40}(?:&|$)/;

test("an earlier version is read at its commit and kept by the browser", async ({
  page,
}) => {
  await signInAsAlice(page);

  const firstRead = page.waitForResponse(
    (response) =>
      response.url().includes("/raw/") && COMMIT_REF.test(response.url()),
  );
  await page.goto(`${DOCUMENT}?version=1`);
  const response = await firstRead;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe(
    "private, max-age=31536000, immutable",
  );

  // Chromium says whether an answer came from its own cache; Playwright's
  // response object does not, so ask the protocol.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const servedFromCache: string[] = [];
  const servedByNetwork: string[] = [];
  cdp.on("Network.requestServedFromCache", ({ requestId }) => {
    servedFromCache.push(requestId);
  });
  cdp.on("Network.responseReceived", ({ requestId, response: answer }) => {
    if (!answer.url.includes("/raw/") || !COMMIT_REF.test(answer.url)) return;
    if (answer.fromDiskCache || servedFromCache.includes(requestId)) return;
    servedByNetwork.push(answer.url);
  });

  const secondRead = page.waitForResponse(
    (again) => again.url().includes("/raw/") && COMMIT_REF.test(again.url()),
  );
  await page.reload();
  await secondRead;

  expect(servedByNetwork).toEqual([]);
});

test("signing in and out each clear what the last session kept", async () => {
  const headers = { "Content-Type": "application/json", Origin: APP_BASE_URL };
  const signIn = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      identifier: GITEA_ADMIN_USER,
      password: GITEA_ADMIN_PASS,
    }),
  });
  expect(signIn.status).toBe(200);
  expect(signIn.headers.get("clear-site-data")).toBe('"cache"');

  const session = (signIn.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  const signOut = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    headers: { ...headers, Cookie: `bindersnap_session=${session}` },
  });
  expect(signOut.status).toBe(200);
  expect(signOut.headers.get("clear-site-data")).toBe('"cache"');
});
