import { expect, test } from "bun:test";
import { parseDocumentSearchQuery } from "./documentSearch";

// --- parseDocumentSearchQuery unit tests ---

test("parseDocumentSearchQuery: empty string returns empty params", () => {
  const result = parseDocumentSearchQuery("", "alice");
  expect(result).toEqual({});
});

test("parseDocumentSearchQuery: owner:@me resolves to currentUsername", () => {
  const result = parseDocumentSearchQuery("owner:@me", "alice");
  expect(result.ownerUsername).toBe("alice");
  expect(result.memberUsername).toBeUndefined();
  expect(result.freeText).toBeUndefined();
});

test("parseDocumentSearchQuery: owner:@bob resolves to bob", () => {
  const result = parseDocumentSearchQuery("owner:@bob", "alice");
  expect(result.ownerUsername).toBe("bob");
});

test("parseDocumentSearchQuery: contributed-by:@me resolves to currentUsername", () => {
  const result = parseDocumentSearchQuery("contributed-by:@me", "alice");
  expect(result.memberUsername).toBe("alice");
  expect(result.ownerUsername).toBeUndefined();
});

test("parseDocumentSearchQuery: contributed-by:@carol resolves to carol", () => {
  const result = parseDocumentSearchQuery("contributed-by:@carol", "alice");
  expect(result.memberUsername).toBe("carol");
});

test("parseDocumentSearchQuery: free text only", () => {
  const result = parseDocumentSearchQuery("quarterly report", "alice");
  expect(result.freeText).toBe("quarterly report");
  expect(result.ownerUsername).toBeUndefined();
  expect(result.memberUsername).toBeUndefined();
});

test("parseDocumentSearchQuery: owner + free text", () => {
  const result = parseDocumentSearchQuery("owner:@bob hello world", "alice");
  expect(result.ownerUsername).toBe("bob");
  expect(result.freeText).toBe("hello world");
  expect(result.memberUsername).toBeUndefined();
});

test("parseDocumentSearchQuery: contributed-by + owner + free text", () => {
  const result = parseDocumentSearchQuery(
    "owner:@me contributed-by:@carol draft",
    "alice",
  );
  expect(result.ownerUsername).toBe("alice");
  expect(result.memberUsername).toBe("carol");
  expect(result.freeText).toBe("draft");
});

// --- getWorkspaceDocuments integration tests ---

function runApiCheck(script: string) {
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

test("getWorkspaceDocuments with no params sends no query string", () => {
  const result = runApiCheck(`
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
      fetch: async (input, init) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await getWorkspaceDocuments();

    if (!fetchUrl.endsWith("/api/app/documents")) {
      console.error("expected /api/app/documents but got", fetchUrl);
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

test("getWorkspaceDocuments with structured params sends them as URL query string", () => {
  const result = runApiCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    let fetchUrl = "";
    let fetchBody = null;
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async (input, init) => {
        fetchUrl = typeof input === "string" ? input : input.url;
        fetchBody = init?.body ?? null;
        return new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await getWorkspaceDocuments({ ownerUsername: "alice", freeText: "report" });

    const url = new URL(fetchUrl.startsWith("http") ? fetchUrl : "http://x" + fetchUrl);
    if (url.searchParams.get("owner") !== "alice") {
      console.error("expected owner=alice but got", url.searchParams.get("owner"));
      process.exit(1);
    }
    if (url.searchParams.get("q") !== "report") {
      console.error("expected q=report but got", url.searchParams.get("q"));
      process.exit(1);
    }
    if (fetchBody !== null && fetchBody !== undefined) {
      console.error("expected no request body but got", fetchBody);
      process.exit(1);
    }
  `);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});
