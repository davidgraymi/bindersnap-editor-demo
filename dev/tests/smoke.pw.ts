import { test, expect, type APIRequestContext } from "@playwright/test";
import { isTokenValid, seedDevStack } from "./seed";

// Integration smoke tests against the live dev stack.
// Requires: docker compose up (dev/)
// Optional: set VITE_GITEA_TOKEN to reuse an existing token.

const TOKEN = process.env.VITE_GITEA_TOKEN ?? "";
const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";
const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";
const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? "bindersnap-dev";
let AUTH_HEADERS: Record<string, string> = {};

async function waitForSeededPullRequest(
  request: APIRequestContext,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pullsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls?state=open`,
      {
        headers: AUTH_HEADERS,
      },
    );

    if (pullsRes.status() === 200) {
      const pulls = (await pullsRes.json()) as Array<{
        number: number;
        head?: { ref?: string };
      }>;
      const pr = pulls.find(
        (item) => item.head?.ref === "feature/q2-amendments",
      );

      if (pr) {
        const reviewsRes = await request.get(
          `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls/${pr.number}/reviews`,
          { headers: AUTH_HEADERS },
        );

        if (reviewsRes.status() === 200) {
          const reviews = (await reviewsRes.json()) as Array<{
            user?: { login?: string };
            state?: string;
            body?: string;
          }>;

          const hasRequestedChanges = reviews.some(
            (item) =>
              item.user?.login === "bob" &&
              item.body ===
                "Section 4.2 needs to reference the updated GDPR guidance from the January memo." &&
              (item.state === "REQUEST_CHANGES" ||
                item.state === "CHANGES_REQUESTED"),
          );

          if (hasRequestedChanges) {
            return;
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for seeded PR and review state");
}

test.describe("Gitea dev stack health", () => {
  test.beforeAll(async ({ request }) => {
    const preferredToken = TOKEN.trim();
    const usePreferredToken =
      preferredToken.length > 0 &&
      (await isTokenValid(GITEA_URL, preferredToken));

    const seedResult = await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: !usePreferredToken,
      tokenNamePrefix: "bindersnap-test",
      log: () => {
        // Keep Playwright output focused on test results.
      },
    });

    const resolvedToken = usePreferredToken ? preferredToken : seedResult.token;
    if (!resolvedToken) {
      throw new Error(
        "Unable to resolve a valid Gitea token. Set VITE_GITEA_TOKEN or check seed/admin credentials.",
      );
    }
    AUTH_HEADERS = { Authorization: `token ${resolvedToken}` };

    await waitForSeededPullRequest(request);
  });

  test("Gitea API is reachable", async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/settings/api`);
    expect(res.status()).toBe(200);
  });

  test("Alice token is valid", async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/user`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status()).toBe(200);
    const user = await res.json();
    expect(user.login).toBe("alice");
  });

  test("Bob has collaborator access", async ({ request }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/collaborators/bob/permission`,
      {
        headers: AUTH_HEADERS,
      },
    );
    expect(res.status()).toBe(200);
    const permission = await res.json();
    expect(permission.permission).toBe("write");
  });

  test("Seeded repo exists with documents", async ({ request }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/documents`,
      { headers: AUTH_HEADERS },
    );
    expect(res.status()).toBe(200);
    const files = await res.json();
    const names = files.map((f: { name: string }) => f.name);
    expect(names).toContain("draft.json");
    expect(names).toContain("in-review.json");
    expect(names).toContain("changes-requested.json");
  });

  test("Feature PR and review are seeded", async ({ request }) => {
    const pullsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls?state=open`,
      {
        headers: AUTH_HEADERS,
      },
    );
    expect(pullsRes.status()).toBe(200);
    const pulls = (await pullsRes.json()) as Array<{
      number: number;
      title: string;
      head?: { ref?: string };
      base?: { ref?: string };
    }>;

    const pr = pulls.find((item) => item.head?.ref === "feature/q2-amendments");
    expect(pr).toBeTruthy();
    expect(pr?.title).toBe("Q2 amendments — GDPR section update");
    expect(pr?.base?.ref).toBe("main");

    const reviewsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls/${pr!.number}/reviews`,
      { headers: AUTH_HEADERS },
    );
    expect(reviewsRes.status()).toBe(200);
    const reviews = (await reviewsRes.json()) as Array<{
      user?: { login?: string };
      state?: string;
      body?: string;
    }>;

    const review = reviews.find(
      (item) =>
        item.user?.login === "bob" &&
        item.body ===
          "Section 4.2 needs to reference the updated GDPR guidance from the January memo." &&
        (item.state === "REQUEST_CHANGES" ||
          item.state === "CHANGES_REQUESTED"),
    );
    expect(review).toBeTruthy();
  });
});

test.describe("App shell", () => {
  test("Landing route loads", async ({ page }) => {
    await page.goto("/landing");
    await expect(page).toHaveTitle(/Finally Kill the Email Approval Chain/);
    await expect(
      page.getByRole("link", { name: "Join the Waitlist" }),
    ).toBeVisible();
  });

  test("Authenticated app route loads", async ({ page }) => {
    await page.goto("/app");

    const appHeading = page.getByRole("heading", {
      name: "alice/quarterly-report",
    });
    const loginHeading = page.getByRole("heading", {
      name: "Step into the clean version.",
    });

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
      return;
    }

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
