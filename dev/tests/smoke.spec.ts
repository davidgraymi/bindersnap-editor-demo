import { test, expect, type APIRequestContext } from '@playwright/test';

// Integration smoke tests against the live dev stack.
// Requires: docker compose up (dev/)
// Requires: VITE_GITEA_TOKEN env var set

const TOKEN = process.env.VITE_GITEA_TOKEN ?? '';
const GITEA_URL = process.env.VITE_GITEA_URL ?? 'http://localhost:3000';
const AUTH_HEADERS = { Authorization: `token ${TOKEN}` };

async function waitForSeededPullRequest(request: APIRequestContext): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pullsRes = await request.get(`${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls?state=open`, {
      headers: AUTH_HEADERS,
    });

    if (pullsRes.status() === 200) {
      const pulls = (await pullsRes.json()) as Array<{ number: number; head?: { ref?: string } }>;
      const pr = pulls.find((item) => item.head?.ref === 'feature/q2-amendments');

      if (pr) {
        const reviewsRes = await request.get(
          `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls/${pr.number}/reviews`,
          { headers: AUTH_HEADERS }
        );

        if (reviewsRes.status() === 200) {
          const reviews = (await reviewsRes.json()) as Array<{
            user?: { login?: string };
            state?: string;
            body?: string;
          }>;

          const hasRequestedChanges = reviews.some(
            (item) =>
              item.user?.login === 'bob' &&
              item.body === 'Section 4.2 needs to reference the updated GDPR guidance from the January memo.' &&
              (item.state === 'REQUEST_CHANGES' || item.state === 'CHANGES_REQUESTED')
          );

          if (hasRequestedChanges) {
            return;
          }
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Timed out waiting for seeded PR and review state');
}

test.describe('Gitea dev stack health', () => {
  test.beforeAll(async ({ request }) => {
    await waitForSeededPullRequest(request);
  });

  test('Gitea API is reachable', async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/settings/api`);
    expect(res.status()).toBe(200);
  });

  test('Alice token is valid', async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/user`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status()).toBe(200);
    const user = await res.json();
    expect(user.login).toBe('alice');
  });

  test('Bob has collaborator access', async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/repos/alice/quarterly-report/collaborators/bob/permission`, {
      headers: AUTH_HEADERS,
    });
    expect(res.status()).toBe(200);
    const permission = await res.json();
    expect(permission.permission).toBe('write');
  });

  test('Seeded repo exists with documents', async ({ request }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/documents`,
      { headers: AUTH_HEADERS }
    );
    expect(res.status()).toBe(200);
    const files = await res.json();
    const names = files.map((f: { name: string }) => f.name);
    expect(names).toContain('draft.json');
    expect(names).toContain('in-review.json');
    expect(names).toContain('changes-requested.json');
  });

  test('Feature PR and review are seeded', async ({ request }) => {
    const pullsRes = await request.get(`${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls?state=open`, {
      headers: AUTH_HEADERS,
    });
    expect(pullsRes.status()).toBe(200);
    const pulls = (await pullsRes.json()) as Array<{
      number: number;
      title: string;
      head?: { ref?: string };
      base?: { ref?: string };
    }>;

    const pr = pulls.find((item) => item.head?.ref === 'feature/q2-amendments');
    expect(pr).toBeTruthy();
    expect(pr?.title).toBe('Q2 amendments — GDPR section update');
    expect(pr?.base?.ref).toBe('main');

    const reviewsRes = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/pulls/${pr!.number}/reviews`,
      { headers: AUTH_HEADERS }
    );
    expect(reviewsRes.status()).toBe(200);
    const reviews = (await reviewsRes.json()) as Array<{
      user?: { login?: string };
      state?: string;
      body?: string;
    }>;

    const review = reviews.find(
      (item) =>
        item.user?.login === 'bob' &&
        item.body === 'Section 4.2 needs to reference the updated GDPR guidance from the January memo.' &&
        (item.state === 'REQUEST_CHANGES' || item.state === 'CHANGES_REQUESTED')
    );
    expect(review).toBeTruthy();
  });
});

test.describe('App shell', () => {
  test('Landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Bindersnap/);
  });

  test('Authenticated app route loads', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Welcome to Bindersnap' })).toBeVisible();
  });
});
