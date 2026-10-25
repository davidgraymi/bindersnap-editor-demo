/**
 * Read per request rather than once at import, so a script that sets it — the
 * seed, pointing at whichever stack it was started against — is not racing
 * the module graph. In the browser bundle the build has already inlined it.
 */
function apiBaseUrl(): string {
  return (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * What a person reads when the API did not answer at all — offline, a dropped
 * connection, an extension that blocked the request. The browser's own words
 * for it ("Failed to fetch", "Load failed", "NetworkError when attempting to
 * fetch resource") say nothing anyone can act on.
 */
export const API_UNREACHABLE_MESSAGE =
  "We couldn't reach Bindersnap. Check your connection and try again.";

/** One finished call to the API, as the feedback trace records it. */
export interface ApiCallRecord {
  method: string;
  path: string;
  /** 0 when there was no answer: offline, blocked, aborted. */
  status: number;
  durationMs: number;
  /** The API's `X-Request-Id`, which every log line for the call carries. */
  requestId: string | null;
}

let observeApiCall: ((call: ApiCallRecord) => void) | null = null;

/**
 * Hear about every call made through here. The app's feedback trace is the
 * only listener (`apps/app/feedbackTrace.ts`); a script has none.
 */
export function setApiCallObserver(
  observer: ((call: ApiCallRecord) => void) | null,
): void {
  observeApiCall = observer;
}

export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const fullUrl = `${apiBaseUrl()}${url}`;
  const method = (options.method ?? "GET").toUpperCase();
  const startedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      credentials: "include",
    });
  } catch (error) {
    observeApiCall?.({
      method,
      path: url,
      status: 0,
      durationMs: performance.now() - startedAt,
      requestId: null,
    });
    // An abort is the caller's own doing, and keeps its name so it can tell.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    // Status 0: there was no answer. The browser's error rides along as data.
    throw new ApiRequestError(0, API_UNREACHABLE_MESSAGE, error);
  }
  observeApiCall?.({
    method,
    path: url,
    status: response.status,
    durationMs: performance.now() - startedAt,
    requestId: response.headers.get("X-Request-Id"),
  });

  if (
    response.status === 204 ||
    response.headers.get("content-length") === "0"
  ) {
    return {
      data: undefined,
      status: response.status,
      headers: response.headers,
    } as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const payload = (await response.json().catch(() => null)) as unknown;
      let message = response.statusText;
      if (typeof payload === "object" && payload !== null) {
        const p = payload as Record<string, unknown>;
        if (typeof p["error"] === "string") message = p["error"];
        else if (typeof p["message"] === "string") message = p["message"];
      }
      throw new ApiRequestError(response.status, message, payload);
    } else {
      const text = await response.text().catch(() => response.statusText);
      throw new ApiRequestError(response.status, text);
    }
  }

  if (!isJson) {
    const blob = await response.blob();
    return {
      data: blob,
      status: response.status,
      headers: response.headers,
    } as T;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    data: payload,
    status: response.status,
    headers: response.headers,
  } as T;
};
