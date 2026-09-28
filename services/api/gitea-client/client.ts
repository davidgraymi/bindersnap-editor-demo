import createClient from "openapi-fetch";

import { giteaRequestGate } from "./request-gate";
import type { paths } from "./spec/gitea";

/** Every Gitea call queues here. See `request-gate.ts` for why. */
const gatedFetch = (input: Request): Promise<Response> =>
  giteaRequestGate.run(() => globalThis.fetch(input));

export type GiteaClient = ReturnType<typeof createGiteaClient>;

export function createGiteaClient(baseUrl: string, token: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `token ${token}`;
  }
  return createClient<paths>({
    baseUrl: `${baseUrl}/api/v1`,
    headers,
    fetch: gatedFetch,
  });
}

/**
 * The same client, authenticated as a Gitea user rather than by token.
 *
 * Dev and test stacks bring Gitea up with admin credentials and no service
 * token to mint one from, so the BFF's privileged reads have always fallen
 * back to basic auth there. This is that fallback, for the reads that go
 * through the typed client instead of raw fetch.
 */
export function createGiteaBasicAuthClient(
  baseUrl: string,
  username: string,
  password: string,
) {
  return createClient<paths>({
    baseUrl: `${baseUrl}/api/v1`,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    },
    fetch: gatedFetch,
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

/**
 * Gitea's page ceiling. Asking for more is not an error, it is silently this:
 * `limit=100` answers with 50, and a caller that stops at "fewer than I asked
 * for" stops after the first page every time.
 */
export const GITEA_PAGE_SIZE = 50;

/**
 * Every page of a Gitea list, in order.
 *
 * Gitea answers an unpaged list with 30 and caps any page at 50, so a list
 * read once is a list that silently stops — binders past the thirtieth, seats
 * past the fiftieth. This reads `limit: 50` pages until a short one arrives.
 *
 * `maxPages` is a stop no real binder reaches, which turns a Gitea that ignored
 * `page` from an infinite loop into a bounded read.
 */
export async function readAllPages<T>(
  readPage: (query: {
    page: number;
    limit: number;
  }) => Promise<T[] | null | undefined>,
  options: { maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? 200;
  const all: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const batch = (await readPage({ page, limit: GITEA_PAGE_SIZE })) ?? [];
    all.push(...batch);
    if (batch.length < GITEA_PAGE_SIZE) break;
  }

  return all;
}
