import { expect, test } from "bun:test";

function runApiSearchCheck(script: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

test("getWorkspaceDocuments with no query makes GET request without query string", () => {
  const result = runApiSearchCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    let fetchUrl = "";
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async (input) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    await getWorkspaceDocuments();

    if (!fetchUrl.endsWith("/api/app/documents")) {
      console.error("expected fetch URL to end with /api/app/documents but got", fetchUrl);
      process.exit(1);
    }

    if (fetchUrl.includes("?")) {
      console.error("expected no query string but got", fetchUrl);
      process.exit(1);
    }
  `);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("getWorkspaceDocuments with query makes GET request with encoded query param", () => {
  const result = runApiSearchCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    let fetchUrl = "";
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async (input) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    await getWorkspaceDocuments("owner:@me");

    if (!fetchUrl.includes("?q=owner%3A%40me")) {
      console.error("expected fetch URL to include ?q=owner%3A%40me but got", fetchUrl);
      process.exit(1);
    }
  `);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("getWorkspaceDocuments with contributed-by query encodes correctly", () => {
  const result = runApiSearchCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    let fetchUrl = "";
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async (input) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    await getWorkspaceDocuments("contributed-by:@alice");

    if (!fetchUrl.includes("?q=contributed-by%3A%40alice")) {
      console.error("expected fetch URL to include ?q=contributed-by%3A%40alice but got", fetchUrl);
      process.exit(1);
    }
  `);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("getWorkspaceDocuments with complex query encodes correctly", () => {
  const result = runApiSearchCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    let fetchUrl = "";
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async (input) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    await getWorkspaceDocuments("owner:@bob hello world");

    const url = new URL(fetchUrl);
    const queryParam = url.searchParams.get("q");

    if (queryParam !== "owner:@bob hello world") {
      console.error("expected query param to be 'owner:@bob hello world' but got", queryParam);
      process.exit(1);
    }
  `);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});
