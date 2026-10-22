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

test("readAllPages reads 50 at a time until a short page", async () => {
  const { readAllPages } = await import("./client");
  const rows = Array.from({ length: 120 }, (_, index) => index);
  const asked: Array<{ page: number; limit: number }> = [];

  const all = await readAllPages(async (query) => {
    asked.push(query);
    return rows.slice((query.page - 1) * query.limit, query.page * query.limit);
  });

  expect(all).toEqual(rows);
  expect(asked).toEqual([
    { page: 1, limit: 50 },
    { page: 2, limit: 50 },
    { page: 3, limit: 50 },
  ]);
});

test("readAllPages stops at maxPages when Gitea ignores page", async () => {
  const { readAllPages } = await import("./client");
  let calls = 0;

  // A full page every time, as a Gitea that ignored `page` would answer.
  const all = await readAllPages(
    async () => {
      calls += 1;
      return Array.from({ length: 50 }, () => 0);
    },
    { maxPages: 3 },
  );

  expect(calls).toBe(3);
  expect(all).toHaveLength(150);
});

test("readAllPages reads one page alone, then the rest in waves", async () => {
  const { readAllPages } = await import("./client");

  const short = Array.from({ length: 12 }, (_, index) => index);
  let calls = 0;
  const one = await readAllPages(
    async () => {
      calls += 1;
      return short;
    },
    { parallel: 3 },
  );
  // A list that fits on one page costs one call, however wide the waves.
  expect(one).toEqual(short);
  expect(calls).toBe(1);

  const rows = Array.from({ length: 180 }, (_, index) => index);
  const inFlight: number[] = [];
  let running = 0;
  const all = await readAllPages(
    async ({ page, limit }) => {
      running += 1;
      inFlight.push(running);
      await Bun.sleep(1);
      running -= 1;
      return rows.slice((page - 1) * limit, page * limit);
    },
    { parallel: 3 },
  );
  expect(all).toEqual(rows);
  expect(Math.max(...inFlight)).toBe(3);
});
