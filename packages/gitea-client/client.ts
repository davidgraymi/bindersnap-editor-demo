import createClient from "openapi-fetch";

import type { paths } from "./spec/gitea";

export type GiteaClient = ReturnType<typeof createGiteaClient>;

export function createGiteaClient(baseUrl: string, token: string) {
  return createClient<paths>({
    baseUrl: `${baseUrl}/api/v1`,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
    },
  });
}

export class GiteaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GiteaApiError";
  }
}

/**
 * Extract a GiteaApiError from any openapi-fetch error response.
 * Replaces the five-way readErrorMessage() functions that were duplicated
 * across every module when using the previous client library.
 */
export function toGiteaApiError(
  status: number,
  errorBody: unknown,
): GiteaApiError {
  if (errorBody instanceof GiteaApiError) {
    return errorBody;
  }

  let message = "Gitea request failed.";

  if (typeof errorBody === "string" && errorBody.trim() !== "") {
    message = errorBody;
  } else if (typeof errorBody === "object" && errorBody !== null) {
    const body = errorBody as Record<string, unknown>;
    if (typeof body.message === "string" && body.message.trim() !== "") {
      message = body.message;
    } else if (typeof body.error === "string" && body.error.trim() !== "") {
      message = body.error;
    }
  }

  return new GiteaApiError(status, message);
}

/**
 * Unwrap an openapi-fetch response, throwing GiteaApiError on failure.
 * Use this to replace the try/catch + toGiteaApiError pattern in every module.
 *
 * Usage:
 *   const repo = await unwrap(client.GET("/repos/{owner}/{repo}", { params: { path: { owner, repo } } }));
 */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;

  if (error !== undefined || data === undefined) {
    throw toGiteaApiError(response.status, error);
  }

  return data;
}
