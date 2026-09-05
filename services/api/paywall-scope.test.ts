import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ADR 0004: "the paywall gates authoring and mutation; it never gates reading
 * or exporting."
 *
 * That is a structural promise, not a nicety — reads and exports stay open
 * forever, whatever an organization owes us, because holding a customer's
 * approval history hostage would poison a compliance reference permanently.
 * The ADR asks for exactly this check rather than a route-by-route audit: no
 * GET under /api/app/documents or /api/app/binders may reach
 * requireSubscription.
 *
 * This reads the router out of server.ts rather than mocking a stack, so it
 * catches a new read route the moment it is added, before anyone runs it.
 */

const SERVER = readFileSync(join(import.meta.dir, "server.ts"), "utf8");

/**
 * The two addresses a record is read at: the document repositories of ADR
 * 0001's model, and the binders that replace them. Both are covered because
 * the promise is about reading, not about which shape the record is in.
 */
const READ_PREFIXES = ["/api/app/documents", "/api/app/binders"];
const PAYWALL_FUNCTIONS = ["requireSubscription", "requireSubscriptionOrAdmin"];

interface Route {
  method: string;
  path: string;
  handler: string;
}

/**
 * Every `const fooMatch = pathname.match(/…/)` in the router, so a route
 * dispatched on a matcher can be resolved back to the path it serves.
 */
function collectPathMatchers(source: string): Map<string, string> {
  const matchers = new Map<string, string>();
  const pattern = /const (\w+) = pathname\.match\(\s*\/(.+?)\/,?\s*\)/gs;

  for (const match of source.matchAll(pattern)) {
    matchers.set(match[1]!, match[2]!);
  }

  return matchers;
}

/** Every function in the file, by name, with its body. */
function collectFunctions(source: string): Map<string, string> {
  const lines = source.split("\n");
  const functions = new Map<string, string>();
  let current: string | null = null;
  let body: string[] = [];

  for (const line of lines) {
    const start = /^(?:async )?function (\w+)/.exec(line);
    if (start) {
      if (current) functions.set(current, body.join("\n"));
      current = start[1]!;
      body = [line];
      continue;
    }
    if (current) {
      body.push(line);
      if (line === "}") {
        functions.set(current, body.join("\n"));
        current = null;
        body = [];
      }
    }
  }

  if (current) functions.set(current, body.join("\n"));
  return functions;
}

/** The router's dispatch table: condition → handler. */
function collectRoutes(source: string): Route[] {
  const matchers = collectPathMatchers(source);
  const routes: Route[] = [];
  const pattern =
    /(?:\}\s*else\s+)?if\s*\(([^{]*?)\)\s*\{\s*response = await (\w+)\(/gs;

  for (const match of source.matchAll(pattern)) {
    const condition = match[1]!;
    const handler = match[2]!;

    const method = /method === "(\w+)"/.exec(condition)?.[1];
    if (!method) continue;

    const literalPath = /pathname === "([^"]+)"/.exec(condition)?.[1];
    if (literalPath) {
      routes.push({ method, path: literalPath, handler });
      continue;
    }

    const matcherName = /(\w+Match)\b/.exec(condition)?.[1];
    const matcherPattern = matcherName ? matchers.get(matcherName) : undefined;
    if (matcherPattern) {
      routes.push({ method, path: matcherPattern, handler });
    }
  }

  return routes;
}

/**
 * Names reachable from `entry` by direct call, within this file. A read
 * handler that delegates its auth to a helper is still a read handler.
 */
function reachableFrom(
  entry: string,
  functions: Map<string, string>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);

    const body = functions.get(name);
    if (!body) continue;

    for (const call of body.matchAll(/\b(\w+)\s*\(/g)) {
      const callee = call[1]!;
      if (!seen.has(callee) && functions.has(callee)) {
        queue.push(callee);
      }
    }
  }

  return seen;
}

/** A matcher pattern like `^\/api\/app\/documents\/…` unescaped for display. */
function readablePath(path: string): string {
  return path.replace(/\\\//g, "/").replace(/^\^/, "").replace(/\$$/, "");
}

const functions = collectFunctions(SERVER);
const routes = collectRoutes(SERVER);
const readRoutes = routes.filter(
  (route) =>
    route.method === "GET" &&
    READ_PREFIXES.some((prefix) => readablePath(route.path).startsWith(prefix)),
);

describe("the paywall gates mutation, never reading", () => {
  test("the router is parsed, so this suite is testing something", () => {
    // If the dispatch shape in server.ts changes, these numbers go to zero and
    // every assertion below passes vacuously. Fail loudly instead.
    expect(routes.length).toBeGreaterThan(20);
    expect(readRoutes.length).toBeGreaterThan(5);
    expect(functions.has("requireSubscription")).toBe(true);
  });

  test("no GET on a record reaches requireSubscription", () => {
    const offenders = readRoutes
      .filter((route) =>
        [...reachableFrom(route.handler, functions)].some((name) =>
          PAYWALL_FUNCTIONS.includes(name),
        ),
      )
      .map((route) => `${route.method} ${readablePath(route.path)}`);

    // Reading the record is never gated. A GET that ends up here has to be
    // rewritten to requireSession, not exempted.
    expect(offenders).toEqual([]);
  });

  test("both shapes of record are actually being checked", () => {
    // A prefix that matches nothing would let half the rule go unenforced in
    // silence — which is how it would go wrong.
    for (const prefix of READ_PREFIXES) {
      expect(
        readRoutes.filter((route) =>
          readablePath(route.path).startsWith(prefix),
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  test("the ways a file leaves in particular stay open", () => {
    // Exporting is the read that matters most: it is how a customer answers a
    // surveyor, and it is the one we can never take away. Both models have a
    // route for it — a repository's `/download` and a binder's `/raw/`.
    const exports = readRoutes.filter((route) => {
      const path = readablePath(route.path);
      return path.endsWith("/download") || path.includes("/raw/");
    });

    expect(exports.length).toBeGreaterThanOrEqual(2);
    for (const route of exports) {
      expect([...reachableFrom(route.handler, functions)]).not.toContain(
        "requireSubscription",
      );
    }
  });

  test("mutations are still gated", () => {
    // The other half of the rule. If this ever empties out, the paywall is
    // gone rather than correctly scoped.
    const gatedMutations = routes.filter(
      (route) =>
        route.method !== "GET" &&
        [...reachableFrom(route.handler, functions)].some((name) =>
          PAYWALL_FUNCTIONS.includes(name),
        ),
    );

    expect(gatedMutations.length).toBeGreaterThan(5);

    const gatedPaths = gatedMutations.map((route) => readablePath(route.path));
    expect(gatedPaths.some((path) => path.endsWith("/publish"))).toBe(true);
    expect(gatedPaths).toContain("/api/app/documents");
  });
});
