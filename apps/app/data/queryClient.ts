/**
 * The app's one cache of what the API has said.
 *
 * Every read the app makes goes through TanStack Query, keyed by
 * {@link queryKeys}: two screens asking the same question at the same moment
 * make one request, an answer already in hand is shown while a fresh one is
 * fetched, and a screen that goes away cancels what it was waiting for — the
 * API passes that cancellation on to Gitea, so an abandoned read frees its
 * slot instead of holding it.
 */

import { QueryClient } from "@tanstack/react-query";

import { ApiRequestError } from "../../../packages/api-client/mutator";

/**
 * Not retried: an answer the API meant. A 4xx is a decision — not found, not
 * allowed, not paid for — and asking again gets the same one.
 */
function isFinal(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.status >= 400 &&
    error.status < 500
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Fresh for half a minute. Long enough that moving between screens
        // that read the same thing does not read it again; short enough that
        // somebody else's publish shows up without a reload.
        staleTime: 30_000,
        retry: (failures, error) => !isFinal(error) && failures < 2,
      },
    },
  });
}

export const queryClient = createQueryClient();
