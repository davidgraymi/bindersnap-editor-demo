import { afterEach, expect, test } from "bun:test";

import {
  API_UNREACHABLE_MESSAGE,
  ApiRequestError,
  customFetch,
} from "./mutator";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("no answer at all is an ApiRequestError a person can read, not the browser's words", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  const failure = await customFetch("/auth/me", {}).catch((error) => error);
  expect(failure).toBeInstanceOf(ApiRequestError);
  expect(failure).toMatchObject({ status: 0, message: API_UNREACHABLE_MESSAGE });
});

test("an abort keeps its name, so the caller can tell it asked for it", async () => {
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as unknown as typeof fetch;

  const failure = await customFetch("/auth/me", {}).catch((error) => error);
  expect(failure).toBeInstanceOf(DOMException);
  expect((failure as DOMException).name).toBe("AbortError");
});
