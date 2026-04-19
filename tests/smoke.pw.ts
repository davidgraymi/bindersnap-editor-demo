/**
 * Smoke tests — basic stack health and app-shell route availability.
 *
 * These tests verify that the Docker Compose stack is up and seeded correctly,
 * and that the app shell responds as expected at the SPA root.
 *
 * Requires: docker compose up (or `bun run test:integration`).
 */

import { test, expect } from "@playwright/test";

import { getPullRequestForBranch } from "../packages/gitea-client/pullRequests";

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
  signInAsAlice,
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

  test("seeded repository keeps main empty before review", async ({
    request,
  }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/document.json`,
      { headers: authHeaders },
    );
    expect(res.status()).toBe(404);
  });

  test("seeded repository stores the canonical document file on the review branch", async ({
    request,
  }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/document.json?ref=feature/q2-amendments`,
      { headers: authHeaders },
    );
    expect(res.status()).toBe(200);
    const file = (await res.json()) as { name?: string; type?: string };
    expect(file.name).toBe("document.json");
    expect(file.type).toBe("file");
  });

  test("seeded repository protects main with review rules", async ({
    request,
  }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/branch_protections`,
      { headers: authHeaders },
    );
    expect(res.status()).toBe(200);
    const rules = (await res.json()) as Array<{
      rule_name?: string;
      required_approvals?: number;
      block_on_rejected_reviews?: boolean;
    }>;
    const mainRule = rules.find((rule) => rule.rule_name === "main");
    expect(mainRule).toBeTruthy();
    expect(mainRule?.required_approvals).toBe(1);
    expect(mainRule?.block_on_rejected_reviews).toBe(true);
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
  test("/ shows the pre-rendered landing page to unauthenticated users", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: /Your approval process/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load Editor" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign Up" }).first(),
    ).toBeVisible();
  });

  test("authenticated users still land in the workspace at /", async ({
    page,
  }) => {
    await signInAsAlice(page);
    await page.goto("/");

    await expect(
      page.locator(".app-user-badge", { hasText: GITEA_ADMIN_USER }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Documents" })).toBeVisible();
  });

  test("deep links still resolve inside the SPA shell", async ({ page }) => {
    await signInAsAlice(page);
    await page.goto(`/docs/${OWNER}/${REPO}`);

    await expect(page).toHaveURL(new RegExp(`/docs/${OWNER}/${REPO}$`));
    await expect(page.locator("nav[aria-label='Breadcrumb']")).toBeVisible();
    await expect(
      page.locator("nav[aria-label='Breadcrumb'] button", {
        hasText: "Documents",
      }),
    ).toBeVisible();
  });
});
