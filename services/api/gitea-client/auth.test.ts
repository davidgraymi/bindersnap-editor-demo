import { afterEach, expect, mock, test } from "bun:test";

/**
 * Mock openapi-fetch's createClient to return a controllable mock client.
 * The mock client has GET/POST/PUT/DELETE as mock functions whose return
 * values can be set per-test.
 */
const mockGet = mock(
  async (): Promise<{ data: unknown; error: unknown; response: Response }> => ({
    data: {
      id: 42,
      login: "alice",
      full_name: "Alice Admin",
      email: "alice@example.com",
      avatar_url: "https://example.com/alice.png",
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  }),
);

const mockClient = {
  GET: mockGet,
  POST: mock(async () => ({})),
  PUT: mock(async () => ({})),
  DELETE: mock(async () => ({})),
  use: mock(() => {}),
};

mock.module("openapi-fetch", () => ({
  default: () => mockClient,
}));

const createMemoryStorage = (): Storage => {
  const map = new Map<string, string>();

  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  } as Storage;
};

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  writable: true,
  value: createMemoryStorage(),
});

afterEach(() => {
  mockGet.mockReset();
  mockGet.mockImplementation(async () => ({
    data: {
      id: 42,
      login: "alice",
      full_name: "Alice Admin",
      email: "alice@example.com",
      avatar_url: "https://example.com/alice.png",
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  }));

  globalThis.sessionStorage.clear();
});

test("stores, retrieves, and clears the token in sessionStorage", async () => {
  const { storeToken, getStoredToken, clearToken } = await import("./auth");

  storeToken("secret");
  expect(getStoredToken()).toBe("secret");

  clearToken();
  expect(getStoredToken()).toBeNull();
});

test("validateToken returns normalized gitea user data", async () => {
  const { validateToken } = await import("./auth");

  const user = await validateToken("https://gitea.example.com", "good-token");

  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(user).toEqual({
    id: 42,
    login: "alice",
    full_name: "Alice Admin",
    email: "alice@example.com",
    avatar_url: "https://example.com/alice.png",
  });
});

test("validateToken maps error responses to GiteaApiError", async () => {
  const { validateToken } = await import("./auth");

  mockGet.mockImplementation(async () => ({
    data: undefined,
    error: { message: "invalid token" },
    response: new Response(null, { status: 401 }),
  }));

  await expect(
    validateToken("https://gitea.example.com", "bad-token"),
  ).rejects.toMatchObject({
    name: "GiteaApiError",
    status: 401,
    message: "invalid token",
  });
});

test("createAuthenticatedClient uses stored token", async () => {
  const { createAuthenticatedClient, storeToken } = await import("./auth");

  storeToken("stored-token");
  const client = createAuthenticatedClient("https://gitea.example.com");

  expect(client.GET).toBeFunction();
  expect(client.POST).toBeFunction();
});

test("createAuthenticatedClient throws when token is missing", async () => {
  const { createAuthenticatedClient, UnauthenticatedError } =
    await import("./auth");

  expect(() => createAuthenticatedClient("https://gitea.example.com")).toThrow(
    UnauthenticatedError,
  );
});
