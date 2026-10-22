/**
 * The query cache, for a test that mounts a component.
 *
 * A fresh client per mount, so no test sees another's answers, and no retries,
 * so a mocked failure fails at once instead of after the default backoff.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

export function withQueryClient(
  element: ReactElement,
  client: QueryClient = createTestQueryClient(),
): ReactElement {
  return createElement(QueryClientProvider, { client }, element);
}
