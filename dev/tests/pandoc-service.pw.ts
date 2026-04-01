/**
 * Integration tests for the pandoc conversion service.
 *
 * These tests hit the running pandoc Docker service directly on port 3001.
 * They require the dev stack to be running (bun run up or bun run test:integration).
 */

import { expect, test } from '@playwright/test';

const PANDOC_URL = process.env.PANDOC_SERVICE_URL ?? 'http://localhost:3001';

test.describe('pandoc conversion service', () => {
  test('GET /health returns { ok: true }', async ({ request }) => {
    const response = await request.get(`${PANDOC_URL}/health`);
    expect(response.status()).toBe(200);
    const body = await response.json() as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test('POST /convert/json-to-docx returns a .docx binary for a minimal doc', async ({ request }) => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello from integration test.' }],
        },
      ],
    };

    const response = await request.post(`${PANDOC_URL}/convert/json-to-docx`, {
      data: { doc },
    });

    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('application/vnd.openxmlformats-officedocument');
    const body = await response.body();
    // .docx files start with PK (ZIP magic bytes)
    expect(body[0]).toBe(0x50); // 'P'
    expect(body[1]).toBe(0x4b); // 'K'
  });

  test('POST /convert/json-to-docx returns 400 for a missing doc field', async ({ request }) => {
    const response = await request.post(`${PANDOC_URL}/convert/json-to-docx`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('unknown route returns 404', async ({ request }) => {
    const response = await request.get(`${PANDOC_URL}/not-found`);
    expect(response.status()).toBe(404);
  });
});
