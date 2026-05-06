const API_BASE_URL = (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

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

export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const fullUrl = `${API_BASE_URL}${url}`;

  const response = await fetch(fullUrl, {
    ...options,
    credentials: "include",
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
