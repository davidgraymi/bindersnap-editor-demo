import { afterEach, expect, mock, test } from "bun:test";

const mockedClient = {
  repos: {},
  issues: {},
  user: {},
  orgs: {},
};

const giteaApiMock = mock(() => mockedClient);

mock.module("gitea-js", () => ({
  giteaApi: giteaApiMock,
}));

afterEach(() => {
  giteaApiMock.mockClear();
});

test("creates a thin gitea-js client with the expected namespaces", async () => {
  const { createGiteaClient } = await import("./client");

  const client = createGiteaClient("https://gitea.example.com", "secret-token");

  expect(giteaApiMock).toHaveBeenCalledTimes(1);
  expect(giteaApiMock).toHaveBeenCalledWith("https://gitea.example.com", {
    token: "secret-token",
  });
  expect(client).toBe(mockedClient);
  expect(client.repos).toBeDefined();
  expect(client.issues).toBeDefined();
  expect(client.user).toBeDefined();
  expect(client.orgs).toBeDefined();
});

test("exposes a typed GiteaApiError status property", async () => {
  const { GiteaApiError } = await import("./client");

  const error = new GiteaApiError(404, "repository not found");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(GiteaApiError);
  expect(error.name).toBe("GiteaApiError");
  expect(error.status).toBe(404);
  expect(error.message).toBe("repository not found");
});
