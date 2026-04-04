/**
 * Smoke tests — basic stack health and app-shell route availability.
 *
 * These tests verify that the Docker Compose stack is up and seeded correctly,
 * and that the two app routes (landing, app shell) respond as expected.
 *
 * Requires: docker compose up (or `bun run test:integration`).
 */

import { test, expect } from "@playwright/test";

import {
  getPullRequestForBranch,
} from "../packages/gitea-client/pullRequests";

import {
  APP_BASE_URL,
  GITEA_ADMIN_USER,
  GITEA_ADMIN_PASS,
  GITEA_URL,
  installMemorySessionStorage,
  makeClient,
  OWNER,
  pollUntil,
  REPO,
  resolveAndStoreToken,
  SEEDED_BRANCH,
} from "./helpers";

import { seedDevStack } from "./seed";

// ---------------------------------------------------------------------------
// Suite setup — seed the stack and wait for the fixture PR to stabilise.
// ---------------------------------------------------------------------------

let authHeaders: Record<string, string> = {};

test.beforeAll(async () => {
  installMemorySessionStorage();

  const token = await resolveAndStoreToken("bindersnap-smoke");
  authHeaders = { Authorization: `token ${token}` };

  // Block until the seeded PR carries the expected "changes_requested" state
  // so that fixture-dependent assertions do not race against Gitea indexing.
  await pollUntil(async () => {
    const pr = await getPullRequestForBranch({
      client: makeClient(),
      owner: OWNER,
      repo: REPO,
      branch: SEEDED_BRANCH,
    });
    return pr?.approvalState === "changes_requested";
  }, "seeded pull request to reach changes_requested state");
});

// ---------------------------------------------------------------------------
// Gitea dev stack health
// ---------------------------------------------------------------------------

test.describe("Gitea dev stack health", () => {
  test("Gitea API settings endpoint is reachable", async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/settings/api`);
    expect(res.status()).toBe(200);
  });

  test("alice token authenticates successfully against /api/v1/user", async ({
    request,
  }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/user`, {
      headers: authHeaders,
    });
    expect(res.status()).toBe(200);
    const user = (await res.json()) as { login?: string };
    expect(user.login).toBe("alice");
  });

  test("bob has write collaborator access on the seeded repository", async ({
    request,
  }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/collaborators/bob/permission`,
      { headers: authHeaders },
    );
    expect(res.status()).toBe(200);
    const payload = (await res.json()) as { permission?: string };
    expect(payload.permission).toBe("write");
  });

  test("seeded repository contains the three expected document files", async ({
    request,
  }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/documents`,
      { headers: authHeaders },
    );
    expect(res.status()).toBe(200);
    const files = (await res.json()) as Array<{ name: string }>;
    const names = files.map((f) => f.name);
    expect(names).toContain("draft.json");
    expect(names).toContain("in-review.json");
    expect(names).toContain("changes-requested.json");
  });

  test("seeded PR from feature/q2-amendments has bob's changes_requested review", async ({
    request,
  }) => {
    const pullsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls?state=open`,
      { headers: authHeaders },
    );
    expect(pullsRes.status()).toBe(200);

    const pulls = (await pullsRes.json()) as Array<{
      number: number;
      title: string;
      head?: { ref?: string };
      base?: { ref?: string };
    }>;

    const pr = pulls.find((p) => p.head?.ref === "feature/q2-amendments");
    expect(pr).toBeTruthy();
    expect(pr!.title).toBe("Q2 amendments — GDPR section update");
    expect(pr!.base?.ref).toBe("main");

    const reviewsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls/${pr!.number}/reviews`,
      { headers: authHeaders },
    );
    expect(reviewsRes.status()).toBe(200);

    const reviews = (await reviewsRes.json()) as Array<{
      user?: { login?: string };
      state?: string;
      body?: string;
    }>;

    const review = reviews.find(
      (r) =>
        r.user?.login === "bob" &&
        r.body ===
          "Section 4.2 needs to reference the updated GDPR guidance from the January memo." &&
        (r.state === "REQUEST_CHANGES" || r.state === "CHANGES_REQUESTED"),
    );
    expect(review).toBeTruthy();
  });

  test("seedDevStack is idempotent — re-running does not throw or duplicate data", async () => {
    await expect(
      seedDevStack({
        baseUrl: GITEA_URL,
        adminUser: GITEA_ADMIN_USER,
        adminPass: GITEA_ADMIN_PASS,
        createToken: false,
        log: () => undefined,
      }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// App shell routes
// ---------------------------------------------------------------------------

test.describe("app shell routes", () => {
  test("landing route serves a page titled 'Finally Kill the Email Approval Chain'", async ({
    page,
  }) => {
    await page.goto("/landing");
    await expect(page).toHaveTitle(/Finally Kill the Email Approval Chain/);
    await expect(
      page.getByRole("link", { name: "Join the Waitlist" }),
    ).toBeVisible();
  });

  test("/app route either shows the workspace heading or redirects to the login page", async ({
    page,
  }) => {
    await page.goto("/app");

    const appHeading = page.getByRole("heading", {
      name: "alice/quarterly-report",
    });
    const loginHeading = page.getByRole("heading", {
      name: "Step into the clean version.",
    });

    // Wait until one of the two states is resolved.
    await expect
      .poll(
        async () => {
          if (await appHeading.isVisible().catch(() => false)) {
            return "app";
          }
          if (await loginHeading.isVisible().catch(() => false)) {
            return "login";
          }
          return "pending";
        },
        { timeout: 10_000 },
      )
      .not.toBe("pending");

    if (await appHeading.isVisible().catch(() => false)) {
      // Already authenticated — nothing more to check.
      return;
    }

    // Unauthenticated path: verify the login form is present.
    await expect(page).toHaveURL(/\/login$/);
    await expect(loginHeading).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create one" }),
    ).toBeVisible();
  });
});
