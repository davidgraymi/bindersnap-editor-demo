import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Everything the API imports at runtime has to be inside the container image.
 *
 * `services/api/Dockerfile` copies a subset of the repository — `services/api`
 * and whatever else is listed — and nothing checks that the code stays inside
 * it. An import that reaches outside type-checks, passes every unit test, and
 * then kills the container on boot, where it surfaces as the integration suite
 * timing out after five minutes waiting for an API that was never coming.
 *
 * That is the slowest feedback loop in the repository for one of its cheapest
 * mistakes, so this closes it: the same failure now takes two seconds and says
 * which import did it.
 *
 * Only runtime imports count. `import type` is erased before the container
 * ever sees it, which is why the API can name types from `packages/api-schema`
 * without shipping it.
 */

const API_DIR = resolve(import.meta.dir);
const REPO_ROOT = resolve(API_DIR, "../..");
const DOCKERFILE = join(API_DIR, "Dockerfile");

/** The paths `COPY <src> <dest>` puts into the image, repo-relative. */
function copiedPaths(): string[] {
  return readFileSync(DOCKERFILE, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("COPY ") && !line.includes("--from="))
    .flatMap((line) => line.split(/\s+/).slice(1, -1))
    .filter((src) => src !== "." && !src.endsWith("/."));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" || entry === "spec"
        ? []
        : sourceFiles(full);
    }
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

/**
 * Runtime import specifiers, with `import type` and inline `type` members
 * dropped — those never reach the container.
 */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const isTypeOnly = Boolean(match[1]);
    const clause = match[2] ?? "";
    if (isTypeOnly) continue;

    // `import { type A, b } from "x"` still loads the module for `b`; only a
    // clause whose every member is a type is erased entirely.
    const named = clause.match(/\{([\s\S]*)\}/)?.[1];
    if (named !== undefined) {
      const members = named
        .split(",")
        .map((member) => member.trim())
        .filter(Boolean);
      const hasValue = members.some((member) => !member.startsWith("type "));
      const hasDefaultOrNamespace = clause.replace(/\{[\s\S]*\}/, "").trim();
      if (!hasValue && !hasDefaultOrNamespace) continue;
    }

    specifiers.push(match[3]!);
  }

  return specifiers;
}

describe("what the API image has to contain", () => {
  const files = sourceFiles(API_DIR);
  const copied = copiedPaths();

  it("finds the API sources and the Dockerfile's COPY list", () => {
    // Guard against this whole file quietly becoming a no-op.
    expect(files.length).toBeGreaterThan(20);
    expect(copied).toContain("services/api");
  });

  it("imports nothing at runtime that the image does not copy", () => {
    const escapes: string[] = [];

    for (const file of files) {
      for (const specifier of runtimeImports(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;

        const target = resolve(dirname(file), specifier);
        if (target.startsWith(API_DIR)) continue;

        const relative = target.slice(REPO_ROOT.length + 1);
        if (copied.some((path) => relative.startsWith(path))) continue;

        escapes.push(`${file.slice(REPO_ROOT.length + 1)} → ${specifier}`);
      }
    }

    expect(
      escapes,
      `These runtime imports reach outside the API container image, which will ` +
        `kill it on boot. Either add the directory to services/api/Dockerfile ` +
        `or make the import type-only:\n  ${escapes.join("\n  ")}`,
    ).toEqual([]);
  });
});
