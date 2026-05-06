const API_BASE_URL = (
  (typeof process !== "undefined"
    ? process.env?.BUN_PUBLIC_API_BASE_URL
    : undefined) ?? ""
).replace(/\/$/, "");

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface MutatorOptions {
  url: string;
  method: string;
  headers?: HeadersInit;
  data?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  responseType?: string;
  signal?: AbortSignal;
}

export const customFetch = async <T>(options: MutatorOptions): Promise<T> => {
  const { url, method, headers, data, params, responseType, signal } = options;

  let fullUrl = `${API_BASE_URL}${url}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        qs.set(key, String(value));
      }
    }
    const qStr = qs.toString();
    if (qStr) fullUrl += `?${qStr}`;
  }

  const isFormData = data instanceof FormData;
  const requestHeaders: HeadersInit = {
    Accept: "application/json",
    ...(data && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...headers,
  };

  const response = await fetch(fullUrl, {
    method,
    headers: requestHeaders,
    credentials: "include",
    body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
    signal,
  });

  if (responseType === "blob") {
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new ApiRequestError(response.status, text);
    }
    return response.blob() as Promise<T>;
  }

  if (
    response.status === 204 ||
    response.headers.get("content-length") === "0"
  ) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    let message = response.statusText;
    if (typeof payload === "object" && payload !== null) {
      const p = payload as Record<string, unknown>;
      if (typeof p["error"] === "string") message = p["error"];
      else if (typeof p["message"] === "string") message = p["message"];
    }
    throw new ApiRequestError(response.status, message);
  }

  // Orval expects { data, status, headers } structure
  return {
    data: payload,
    status: response.status,
    headers: response.headers,
  } as T;
};
