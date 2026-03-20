export class GiteaApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GiteaApiError';
    this.status = status;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) {
    return undefined;
  }

  return JSON.stringify(body);
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = response.statusText.trim() || 'Request failed';
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    return fallbackMessage;
  }

  try {
    const parsed: unknown = JSON.parse(rawBody);

    if (isJsonObject(parsed)) {
      const message = parsed.message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }

      const error = parsed.error;
      if (typeof error === 'string' && error.trim()) {
        return error;
      }
    }
  } catch {
    // Ignore parse failures and fall back to the raw text below.
  }

  return rawBody.trim() || fallbackMessage;
}

export class GiteaClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  public get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  public post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  public patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  public delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const headers = new Headers({
      Authorization: `token ${this.token}`,
      Accept: 'application/json',
    });

    const encodedBody = encodeBody(body);
    if (encodedBody !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(joinUrl(this.baseUrl, path), {
      method,
      headers,
      body: encodedBody,
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      throw new GiteaApiError(response.status, message);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }
}

export function createGiteaClient(baseUrl: string, token: string): GiteaClient {
  return new GiteaClient(baseUrl, token);
}
