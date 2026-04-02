import { afterEach, expect, mock, test } from "bun:test";
import type { User } from "gitea-js";

const userGetCurrentMock = mock(async () => ({
  data: {
    id: 42,
    login: "alice",
    full_name: "Alice Admin",
    email: "alice@example.com",
    avatar_url: "https://example.com/alice.png",
  } as User,
}));

const giteaApiMock = mock(() => ({
  user: {
    userGetCurrent: userGetCurrentMock,
  },
}));

mock.module("gitea-js", () => ({
  giteaApi: giteaApiMock,
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
  userGetCurrentMock.mockReset();
  userGetCurrentMock.mockImplementation(async () => ({
    data: {
      id: 42,
      login: "alice",
      full_name: "Alice Admin",
      email: "alice@example.com",
      avatar_url: "https://example.com/alice.png",
    } as User,
  }));

  giteaApiMock.mockClear();
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

  expect(giteaApiMock).toHaveBeenCalledWith("https://gitea.example.com", {
    token: "good-token",
  });
  expect(userGetCurrentMock).toHaveBeenCalledTimes(1);
  expect(user).toEqual({
    id: 42,
    login: "alice",
    full_name: "Alice Admin",
    email: "alice@example.com",
    avatar_url: "https://example.com/alice.png",
  });
});

test("validateToken maps response-like failures to GiteaApiError", async () => {
  const { validateToken } = await import("./auth");

  userGetCurrentMock.mockImplementation(async () => {
    throw {
      status: 401,
      error: {
        message: "invalid token",
      },
    };
  });

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

  expect(giteaApiMock).toHaveBeenCalledWith("https://gitea.example.com", {
    token: "stored-token",
  });
  expect(client.user).toBeDefined();
});

test("createAuthenticatedClient throws when token is missing", async () => {
  const { createAuthenticatedClient, UnauthenticatedError } =
    await import("./auth");

  expect(() => createAuthenticatedClient("https://gitea.example.com")).toThrow(
    UnauthenticatedError,
  );
});
