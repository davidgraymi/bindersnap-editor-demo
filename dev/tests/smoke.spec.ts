import { test, expect } from '@playwright/test';

// Integration smoke tests against the live dev stack.
// Requires: docker compose up (dev/)
// Requires: VITE_GITEA_TOKEN env var set

const TOKEN = process.env.VITE_GITEA_TOKEN ?? '';
const GITEA_URL = process.env.VITE_GITEA_URL ?? 'http://localhost:3000';

test.describe('Gitea dev stack health', () => {
  test('Gitea API is reachable', async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/settings/api`);
    expect(res.status()).toBe(200);
  });

  test('Alice token is valid', async ({ request }) => {
    const res = await request.get(`${GITEA_URL}/api/v1/user`, {
      headers: { Authorization: `token ${TOKEN}` },
    });
    expect(res.status()).toBe(200);
    const user = await res.json();
    expect(user.login).toBe('alice');
  });

  test('Seeded repo exists with documents', async ({ request }) => {
    const res = await request.get(
      `${GITEA_URL}/api/v1/repos/alice/quarterly-report/contents/documents`,
      { headers: { Authorization: `token ${TOKEN}` } }
    );
    expect(res.status()).toBe(200);
    const files = await res.json();
    const names = files.map((f: { name: string }) => f.name);
    expect(names).toContain('draft.json');
    expect(names).toContain('in-review.json');
    expect(names).toContain('changes-requested.json');
  });
});

test.describe('App shell', () => {
  test('Landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Bindersnap/);
  });

  // TODO: add auth flow test once src/app/ entry point exists
});
