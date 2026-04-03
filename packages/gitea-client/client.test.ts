import { expect, test } from "bun:test";

test("creates an openapi-fetch client with GET/POST/PUT/DELETE methods", async () => {
  const { createGiteaClient } = await import("./client");

  const client = createGiteaClient("https://gitea.example.com", "secret-token");

  expect(client.GET).toBeFunction();
  expect(client.POST).toBeFunction();
  expect(client.PUT).toBeFunction();
  expect(client.DELETE).toBeFunction();
});

test("exposes a typed GiteaApiError with status property", async () => {
  const { GiteaApiError } = await import("./client");

  const error = new GiteaApiError(404, "repository not found");

  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(GiteaApiError);
  expect(error.name).toBe("GiteaApiError");
  expect(error.status).toBe(404);
  expect(error.message).toBe("repository not found");
});

test("unwrap throws GiteaApiError on error response", async () => {
  const { unwrap, GiteaApiError } = await import("./client");

  const errorPromise = Promise.resolve({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  });

  expect(unwrap(errorPromise)).rejects.toThrow(GiteaApiError);
});

test("unwrap returns data on success response", async () => {
  const { unwrap } = await import("./client");

  const successPromise = Promise.resolve({
    data: { id: 1, name: "test" },
    error: undefined,
    response: new Response(null, { status: 200 }),
  });

  const result = await unwrap(successPromise);
  expect(result).toEqual({ id: 1, name: "test" });
});

test("toGiteaApiError extracts message from various error shapes", async () => {
  const { toGiteaApiError } = await import("./client");

  // Object with message field
  const err1 = toGiteaApiError(400, { message: "bad request" });
  expect(err1.message).toBe("bad request");
  expect(err1.status).toBe(400);

  // Object with error field
  const err2 = toGiteaApiError(422, { error: "validation failed" });
  expect(err2.message).toBe("validation failed");

  // Plain string
  const err3 = toGiteaApiError(500, "server error");
  expect(err3.message).toBe("server error");

  // Unknown shape
  const err4 = toGiteaApiError(503, { unexpected: true });
  expect(err4.message).toBe("Gitea request failed.");
});
