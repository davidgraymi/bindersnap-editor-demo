import { afterEach, expect, mock, test } from 'bun:test';

import { createGiteaClient, GiteaApiError } from './client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('attaches the Gitea authorization header', async () => {
  const fetchMock = mock(
    async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('token secret-token');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );

  globalThis.fetch = fetchMock as typeof fetch;

  const client = createGiteaClient('https://gitea.example.com/', 'secret-token');
  const result = await client.get<{ ok: boolean }>('/api/v1/user');

  expect(result).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gitea.example.com/api/v1/user');
});

test('throws a typed GiteaApiError for non-2xx responses', async () => {
  const fetchMock = mock(async (): Promise<Response> => {
    return new Response(JSON.stringify({ message: 'repository not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  globalThis.fetch = fetchMock as typeof fetch;

  const client = createGiteaClient('https://gitea.example.com', 'secret-token');

  try {
    await client.get('/api/v1/repos/example/missing');
    throw new Error('Expected request to fail');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GiteaApiError);

    const apiError = error as GiteaApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.message).toBe('repository not found');
  }
});
